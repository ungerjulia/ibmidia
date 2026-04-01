# IB Media Editor — Marca d'Água

Editor de mídia para cobrir marcas d'água e inserir logo em vídeos e imagens.

## Funcionalidades

- **Carregar vídeo ou imagem** — suporta MP4, WebM, JPG, PNG, etc.
- **Cobrir marca d'água** — desenhe retângulos coloridos ou com desfoque sobre a marca d'água
- **Inserir logo** — carregue sua logo (PNG transparente) e posicione livremente ou nos cantos
- **Exportar** — salva o resultado como PNG
- **Ctrl+Z** — desfaz a última cobertura

## Deploy na Vercel

### Opção 1: Via GitHub

1. Faça upload deste projeto para um repositório no GitHub
2. Acesse [vercel.com](https://vercel.com) e conecte seu GitHub
3. Importe o repositório
4. A Vercel detecta automaticamente que é um projeto Vite
5. Clique em Deploy

### Opção 2: Via CLI

```bash
npm install
npm run build
npx vercel --prod
```

## Desenvolvimento local

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`

## Stack

- React 18
- Vite 5
- Canvas API (sem dependências extras)
