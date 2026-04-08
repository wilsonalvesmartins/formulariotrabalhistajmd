const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos estáticos da pasta "public" (seu frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Arquivo onde a chave de API será salva na VPS
const CONFIG_FILE = path.join(__dirname, 'config.json');

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

        // 2. BUSCA O MELHOR MODELO (Ele tenta o 3.1, se não achar cai pro 3.0, 2.5, etc)
        const preferences = ['gemini-3.1-flash', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
        let selectedModelId = validModels[0].name; // Pega o primeiro como plano B
        
        for (const pref of preferences) {
            const found = validModels.find(m => m.name.includes(pref));
            if (found) {
                selectedModelId = found.name;
                break; // Achou o melhor disponível, para de procurar
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

        // 4. RETORNA O ERRO EXATO DO GOOGLE, SEM MASCARAR
        if (!response.ok) {
            return res.status(response.status).json({ error: `Erro retornado pelo modelo ${selectedModelId}: ${respText}` });
        }

        const data = JSON.parse(respText);
        data.usedModel = selectedModelId; // Devolve o nome pra aparecer no frontend
        res.json(data);
        
    } catch (error) {
        console.error('Detalhes do erro na API:', error);
        res.status(500).json({ error: `Erro interno no servidor VPS (Node): ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Trabalhista rodando na porta ${PORT}`);
});
