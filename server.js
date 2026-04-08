const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto'); // Necessário para gerar IDs únicos para os relatórios

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos estáticos da pasta "public" (seu frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Arquivos e pastas do sistema na VPS
const CONFIG_FILE = path.join(__dirname, 'config.json');
const REPORTS_DIR = path.join(__dirname, 'reports');

// Garante que a pasta de relatórios exista na VPS
if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
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

// Rota para salvar a Chave de API
app.post('/api/config', (req, res) => {
    const { password, apiKey } = req.body;
    
    if (password === '93281434@Neto*') {
        if (!apiKey) {
            return res.status(400).json({ success: false, message: 'A chave de API não pode ser vazia.' });
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey }), 'utf8');
        res.json({ success: true, message: 'Chave salva com sucesso na VPS!' });
    } else {
        res.status(401).json({ success: false, message: 'Senha incorreta. Acesso negado.' });
    }
});

// Rota: Testar chave e LISTAR MODELOS DISPONÍVEIS
app.post('/api/test-models', async (req, res) => {
    const apiKey = req.body.apiKey || getApiKey();
    
    if (!apiKey) {
        return res.status(400).json({ success: false, message: 'Forneça uma chave de API para testar.' });
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const text = await response.text();
        
        if (!response.ok) {
            return res.status(response.status).json({ success: false, message: `Erro Google: ${text}` });
        }
        
        const data = JSON.parse(text);
        
        // Filtra só os que servem pra chat/texto
        const modelNames = data.models
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name);
            
        res.json({ success: true, models: modelNames });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Rota que processa a análise (SELEÇÃO INTELIGENTE DE MODELO)
app.post('/api/analyze', async (req, res) => {
    const apiKey = getApiKey();
    
    if (!apiKey) {
        return res.status(401).json({ error: 'Chave de API não configurada no servidor. Cadastre-a na engrenagem.' });
    }

    const { userPrompt, systemPrompt } = req.body;

    try {
        // 1. O BACKEND BATE NO GOOGLE E PEDE A LISTA DOS MODELOS DA SUA CHAVE
        const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const modelsText = await modelsRes.text();
        
        if (!modelsRes.ok) {
            return res.status(modelsRes.status).json({ error: `Falha ao validar chave com o Google: ${modelsText}` });
        }
        
        const modelsData = JSON.parse(modelsText);
        const validModels = modelsData.models.filter(m => 
            m.name.includes('gemini') && 
            m.supportedGenerationMethods && 
            m.supportedGenerationMethods.includes('generateContent')
        );

        if (validModels.length === 0) {
            return res.status(400).json({ error: 'Sua chave de API não possui acesso a nenhum modelo Gemini compatível.' });
        }

        // 2. BUSCA O MELHOR MODELO
        const preferences = ['gemini-3.1-flash', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
        let selectedModelId = validModels[0].name; 
        
        for (const pref of preferences) {
            const found = validModels.find(m => m.name.includes(pref));
            if (found) {
                selectedModelId = found.name;
                break; 
            }
        }

        console.log(`Modelo escolhido pelo servidor para a requisição: ${selectedModelId}`);

        // 3. ENVIA OS DADOS DA ENTREVISTA EXATAMENTE PARA O MODELO QUE ELE ENCONTROU
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${selectedModelId}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: userPrompt }]
                }],
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                }
            })
        });

        const respText = await response.text();

        if (!response.ok) {
            return res.status(response.status).json({ error: `Erro retornado pelo modelo ${selectedModelId}: ${respText}` });
        }

        const data = JSON.parse(respText);
        data.usedModel = selectedModelId; 
        res.json(data);
        
    } catch (error) {
        console.error('Detalhes do erro na API:', error);
        res.status(500).json({ error: `Erro interno no servidor VPS (Node): ${error.message}` });
    }
});

// ==========================================
// ROTAS DE HISTÓRICO DE RELATÓRIOS
// ==========================================

const SENHA_HISTORICO = '36672456';

// Middleware para proteger rotas de leitura/exclusão do histórico
function protegerHistorico(req, res, next) {
    const senhaFornecida = req.headers['x-auth-password'];
    if (senhaFornecida === SENHA_HISTORICO) {
        next();
    } else {
        res.status(401).json({ error: 'Senha incorreta. Acesso negado.' });
    }
}

// Salvar um novo relatório
app.post('/api/reports', (req, res) => {
    try {
        const { nome_cliente, markdown, usedModel } = req.body;
        
        if (!nome_cliente || !markdown) {
            return res.status(400).json({ error: 'Dados insuficientes para salvar.' });
        }

        const id = crypto.randomUUID();
        const data_criacao = new Date().toISOString();
        
        const reportData = {
            id,
            data_criacao,
            nome_cliente,
            markdown,
            usedModel
        };

        const filePath = path.join(REPORTS_DIR, `${id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(reportData, null, 2), 'utf8');

        res.json({ success: true, id });
    } catch (error) {
        console.error('Erro ao salvar relatório:', error);
        res.status(500).json({ error: 'Erro ao salvar relatório na VPS.' });
    }
});

// Listar todos os relatórios
app.get('/api/reports', protegerHistorico, (req, res) => {
    try {
        const files = fs.readdirSync(REPORTS_DIR).filter(file => file.endsWith('.json'));
        
        const reports = files.map(file => {
            const filePath = path.join(REPORTS_DIR, file);
            const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
                id: fileData.id,
                data_criacao: fileData.data_criacao,
                nome_cliente: fileData.nome_cliente,
                usedModel: fileData.usedModel
            };
        });

        // Ordenar do mais recente para o mais antigo
        reports.sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));

        res.json({ success: true, reports });
    } catch (error) {
        console.error('Erro ao listar relatórios:', error);
        res.status(500).json({ error: 'Erro ao listar relatórios da VPS.' });
    }
});

// Buscar um relatório específico
app.get('/api/reports/:id', protegerHistorico, (req, res) => {
    try {
        const { id } = req.params;
        const filePath = path.join(REPORTS_DIR, `${id}.json`);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Relatório não encontrado.' });
        }

        const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json({ success: true, report: fileData });
    } catch (error) {
        console.error('Erro ao buscar relatório:', error);
        res.status(500).json({ error: 'Erro ao buscar o relatório.' });
    }
});

// Excluir um relatório
app.delete('/api/reports/:id', protegerHistorico, (req, res) => {
    try {
        const { id } = req.params;
        const filePath = path.join(REPORTS_DIR, `${id}.json`);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao excluir relatório:', error);
        res.status(500).json({ error: 'Erro ao excluir o relatório.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Trabalhista rodando na porta ${PORT}`);
});
