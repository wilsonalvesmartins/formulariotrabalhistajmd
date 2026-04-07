# Usa a imagem oficial do Node.js
FROM node:20-alpine

# Define o diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia os arquivos de configuração de dependências
COPY package*.json ./

# Instala as dependências
RUN npm install --production

# Copia o restante do código da aplicação
COPY . .

# Expõe a porta que o servidor Node vai rodar
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["npm", "start"]
