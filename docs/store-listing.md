# Chrome Web Store listing draft

## Short description (max 132 chars)

```
Melhorias não oficiais para o SIGC (IBGE): exportação de PDF, KML e CSV da Lista de Endereços, sem coleta de dados.
```
(119 chars)

## Detailed description

```
SIGC-PRO adiciona três botões à Lista de Endereços do SIGC (Sistema
Integrado de Gestão da Coleta, IBGE): PDF-pro, KML-pro e CSV-pro.

• PDF-pro — reexporta o PDF no formato listagem clássico do IBGE, com
  colunas reorganizadas e informações-chave (Controle, Situação, Zona,
  número de selecionados) no cabeçalho.
• KML-pro — exporta os endereços como KML para uso em Google Earth, Google
  Maps ou QGIS, com camadas separadas para domicílios selecionados e não
  selecionados (cores seguras para daltonismo).
• CSV-pro — exporta a tabela como CSV, contornando um problema conhecido
  do portal que impede o download pelos botões nativos de CSV/Excel fora
  da rede VPN.

Os botões nativos do SIGC (PDF, CSV, Excel) não são alterados — o
SIGC-PRO apenas adiciona alternativas ao lado deles.

PRIVACIDADE: nenhum dado sai do computador do usuário. A extensão não
solicita nenhuma permissão do navegador, não faz chamadas de rede — exceto o recurso opcional "Guia + Mapa", que consulta o próprio servidor do SIGC mediante clique e confirmação (nada vai a terceiros)
e não armazena nada — todos os arquivos são gerados localmente e salvos
pelo mecanismo padrão de download do Chrome. Essa garantia é verificada
automaticamente a cada alteração no código-fonte (veja o repositório).

AVISO: projeto independente, sem vínculo oficial com o IBGE. Protótipo
para uso e demonstração à equipe de desenvolvimento do SIGC. Use por sua
conta e risco.

Código-fonte aberto: https://github.com/leoniedu/sigc-pro
```

## Category

Productivity (or "Tools" if available for the target region)

## Screenshots needed (1280x800 or 640x400, at least 1, up to 5)

1. Toolbar close-up: native buttons + PDF-pro/KML-pro/CSV-pro side by side
   (already captured informally during development — recreate cleanly).
2. PDF-pro output: listagem-style PDF page.
3. KML-pro output: opened in Google Earth showing colored placemarks.
4. (optional) CSV-pro output opened in Excel/Sheets.

## Privacy policy URL

https://leoniedu.github.io/sigc-pro/PRIVACY_POLICY.html

## Store visibility

Unlisted (installable only via direct link, not searchable).
