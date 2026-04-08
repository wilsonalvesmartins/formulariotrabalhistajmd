const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos estáticos da pasta "public" (seu frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Arquivos e pastas do sistema na VPS
const CONFIG_FILE = path.join(__dirname, 'config.json');
const INTERVIEWS_DIR = path.join(__dirname, 'interviews');

// Garante que a pasta de entrevistas exista na VPS
if (!fs.existsSync(INTERVIEWS_DIR)) {
    fs.mkdirSync(INTERVIEWS_DIR, { recursive: true });
}

// Senha da área restrita
const SENHA_RESTRITA = '36672456';

// Middleware para proteger rotas da área restrita
function protegerRestrito(req, res, next) {
    const senhaFornecida = req.headers['x-auth-password'];
    if (senhaFornecida === SENHA_RESTRITA) {
        next();
    } else {
        res.status(401).json({ error: 'Senha incorreta. Acesso negado.' });
    }
}

// Função auxiliar para recuperar a chave salva
function getApiKey() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            return data.apiKey;
        } catch (e) {
            console.error('Erro ao ler config.json:', e);
        }
    }
    return process.env.GEMINI_API_KEY || null;
}

// ==========================================
// ROTAS PÚBLICAS (Visão do Cliente)
// ==========================================

// Cliente envia o formulário (Salva os dados crus, sem chamar a IA)
app.post('/api/interviews', (req, res) => {
    try {
        const dadosEntrevista = req.body;
        
        if (!dadosEntrevista.nome) {
            return res.status(400).json({ error: 'O nome é obrigatório.' });
        }

        const id = crypto.randomUUID();
        const data_criacao = new Date().toISOString();
        
        const registro = {
            id,
            data_criacao,
            status: 'pendente', // pendente ou analisado
            dados: dadosEntrevista,
            analise_markdown: null,
            usedModel: null
        };

        const filePath = path.join(INTERVIEWS_DIR, `${id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(registro, null, 2), 'utf8');

        res.json({ success: true, id, message: 'Dados enviados com sucesso!' });
    } catch (error) {
        console.error('Erro ao salvar entrevista:', error);
        res.status(500).json({ error: 'Erro ao enviar dados para o servidor.' });
    }
});


// ==========================================
// ROTAS RESTRITAS (Visão do Administrador)
// ==========================================

// Listar todas as entrevistas
app.get('/api/interviews', protegerRestrito, (req, res) => {
    try {
        const files = fs.readdirSync(INTERVIEWS_DIR).filter(file => file.endsWith('.json'));
        
        const entrevistas = files.map(file => {
            const filePath = path.join(INTERVIEWS_DIR, file);
            const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
                id: fileData.id,
                data_criacao: fileData.data_criacao,
                nome_cliente: fileData.dados.nome,
                status: fileData.status,
                usedModel: fileData.usedModel
            };
        });

        // Ordenar da mais recente para a mais antiga
        entrevistas.sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));

        res.json({ success: true, entrevistas });
    } catch (error) {
        console.error('Erro ao listar entrevistas:', error);
        res.status(500).json({ error: 'Erro ao listar dados do servidor.' });
    }
});

// Buscar uma entrevista específica completa
app.get('/api/interviews/:id', protegerRestrito, (req, res) => {
    try {
        const { id } = req.params;
        const filePath = path.join(INTERVIEWS_DIR, `${id}.json`);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Registro não encontrado.' });
        }

        const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json({ success: true, entrevista: fileData });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar o registro.' });
    }
});

// Excluir uma entrevista
app.delete('/api/interviews/:id', protegerRestrito, (req, res) => {
    try {
        const { id } = req.params;
        const filePath = path.join(INTERVIEWS_DIR, `${id}.json`);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao excluir o registro.' });
    }
});

// Rota que processa a análise com IA e salva no registro
app.post('/api/interviews/:id/analyze', protegerRestrito, async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
        return res.status(401).json({ error: 'Chave de API não configurada no servidor. Acesse as configurações.' });
    }

    const { id } = req.params;
    const filePath = path.join(INTERVIEWS_DIR, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    const registro = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const dados = registro.dados;

    const systemPrompt = `Você é um Assistente Jurídico especializado em Direito do Trabalho Brasileiro (CLT). Analise os dados da entrevista, gere um resumo profissional do caso e liste os principais pedidos para Reclamação Trabalhista. Responda EXCLUSIVAMENTE em formato Markdown. Não crie a petição inicial.`;

    const userPrompt = `Análise do Cliente:
- Nome: ${dados.nome}
- Período: de ${dados.data_entrada} até ${dados.data_saida}
- Último Salário: R$ ${dados.salario}
- CTPS Assinada: ${dados.ctps}
- Ambiente Insalubre/Perigoso: ${dados.insalubridade_periculosidade}
- Recebimento do Adicional: ${dados.recebia_adicional}
- Horário de Trabalho e Escala: ${dados.horario_trabalho}
- Férias Vencidas: ${dados.ferias_vencidas} (Quant: ${dados.quantas_ferias})
- 13º Salário: ${dados.decimo_terceiro}
- FGTS: ${dados.fgts}
- CCT: ${dados.cct}
- Extras: ${dados.detalhes_extras}

Gere o relatório e a lista de pedidos.`;

    try {
        // 1. Busca os modelos disponíveis
        const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!modelsRes.ok) throw new Error(`Falha ao validar chave com o Google.`);
        
        const modelsData = await modelsRes.json();
        const validModels = modelsData.models.filter(m => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'));

        if (validModels.length === 0) throw new Error('Sua chave de API não possui acesso a modelos Gemini.');

        // 2. Seleciona o melhor modelo
        const preferences = ['gemini-3.1-flash', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];
        let selectedModelId = validModels[0].name; 
        
        for (const pref of preferences) {
            if (validModels.find(m => m.name.includes(pref))) {
                selectedModelId = validModels.find(m => m.name.includes(pref)).name;
                break; 
            }
        }

        // 3. Chama a IA
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${selectedModelId}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: userPrompt }] }], systemInstruction: { parts: [{ text: systemPrompt }] } })
        });

        const respText = await response.text();

        if (!response.ok) {
            return res.status(response.status).json({ error: `Erro da IA (${selectedModelId}): ${respText}` });
        }

        const data = JSON.parse(respText);
        const textoMarkdown = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textoMarkdown) throw new Error("A IA retornou uma resposta vazia.");

        // 4. Atualiza e salva o registro
        registro.status = 'analisado';
        registro.analise_markdown = textoMarkdown;
        registro.usedModel = selectedModelId;
        
        fs.writeFileSync(filePath, JSON.stringify(registro, null, 2), 'utf8');

        res.json({ success: true, markdown: textoMarkdown, usedModel: selectedModelId });
        
    } catch (error) {
        console.error('Erro na IA:', error);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// CONFIGURAÇÕES DA API (Admin)
// ==========================================
app.post('/api/config', (req, res) => {
    const { password, apiKey } = req.body;
    if (password === SENHA_RESTRITA) {
        if (!apiKey) return res.status(400).json({ success: false, message: 'Chave vazia.' });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey }), 'utf8');
        res.json({ success: true, message: 'Chave salva com sucesso na VPS!' });
    } else {
        res.status(401).json({ success: false, message: 'Senha incorreta.' });
    }
});

app.post('/api/test-models', async (req, res) => {
    const apiKey = req.body.apiKey || getApiKey();
    if (!apiKey) return res.status(400).json({ success: false, message: 'Forneça uma chave de API.' });
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const text = await response.text();
        if (!response.ok) return res.status(response.status).json({ success: false, message: `Erro: ${text}` });
        const data = JSON.parse(text);
        const modelNames = data.models.filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name);
        res.json({ success: true, models: modelNames });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Trabalhista rodando na porta ${PORT}`);
});
