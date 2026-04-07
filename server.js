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
    // Fallback para variável de ambiente, se configurada no painel do Coolify
    return process.env.GEMINI_API_KEY || null;
}

// Rota para salvar a Chave de API (Protegida pela senha)
app.post('/api/config', (req, res) => {
    const { password, apiKey } = req.body;
    
    // Verificação da senha definida pelo usuário
    if (password === '93281434@Neto*') {
        if (!apiKey) {
            return res.status(400).json({ success: false, message: 'A chave de API não pode ser vazia.' });
        }
        
        // Salva a chave em um arquivo JSON local na VPS
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey }), 'utf8');
        res.json({ success: true, message: 'Chave salva com sucesso no servidor!' });
    } else {
        res.status(401).json({ success: false, message: 'Senha incorreta. Acesso negado.' });
    }
});

// Rota que processa a análise (comunica com o Gemini)
app.post('/api/analyze', async (req, res) => {
    const apiKey = getApiKey();
    
    if (!apiKey) {
        return res.status(500).json({ 
            error: 'Chave de API não configurada. Clique na engrenagem no topo da página para configurar.' 
        });
    }

    const { userPrompt, systemPrompt } = req.body;

    try {
        // Chamada oficial para a API do Gemini a partir do backend seguro
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
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

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erro da API: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        // Retorna a resposta exata para o Frontend
        res.json(data);
        
    } catch (error) {
        console.error('Erro na integração com Gemini:', error);
        res.status(500).json({ error: 'Erro ao processar a requisição com a IA.' });
    }
});

// Inicia o servidor na porta 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Trabalhista rodando na porta ${PORT}`);
});
