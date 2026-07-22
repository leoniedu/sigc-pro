# Chrome Web Store listing draft

## Short description (max 132 chars)

```
Melhorias não oficiais para o SIGC (IBGE): PDF, KML e CSV da Lista de Endereços e ferramentas da Agenda, sem coleta de dados.
```
(124 chars)

## Detailed description

```
SIGC-PRO adiciona botões azuis às páginas do SIGC (Sistema Integrado de
Gestão da Coleta, IBGE), ao lado dos botões nativos — que não são
alterados.

Na Lista de Endereços:
• PDF-pro — reexporta o PDF no formato listagem clássico do IBGE, com
  colunas reorganizadas e informações-chave (Controle, Situação, Zona,
  número de selecionados) no cabeçalho.
• KML-pro — exporta os endereços como KML para uso em Google Earth,
  Google Maps ou QGIS, com camadas separadas para domicílios
  selecionados e não selecionados (cores seguras para daltonismo).

Em qualquer relatório com tabela:
• CSV-pro — exporta a tabela como CSV (todas as páginas, pronto para o
  Excel brasileiro), contornando um problema conhecido do portal que
  impede o download pelos botões nativos de CSV/Excel fora da rede VPN.

Em Administrar Agenda:
• CSV-PRO — exporta os slots do calendário (dia/semana em exibição) com
  Controle, Domicílio, nome, endereço, telefone etc. já separados em
  colunas.
• Verificar Slots — alerta sobre slots abertos agendados dentro do prazo
  mínimo de agendamento e sobre zonas cujo nome não corresponde à equipe.
• Guia do Dia — guia HTML autônomo com abas: resumo do dia (com grade
  horário × equipe dos slots), aba Lab compartilhável com o laboratório
  (Controle truncado, sem dados pessoais) e, por equipe, os cartões de
  cada visita — pronto para imprimir por aba.
• Guia + Mapa (opcional) — o mesmo guia com mapa da rota do dia,
  link de navegação por visita e seleção de paradas por checkbox
  (até 9 por rota, com link do Google Maps atualizado em tempo real),
  obtendo as coordenadas do próprio servidor do SIGC mediante clique
  e confirmação.
• Seletor de data — botão de calendário para pular direto a uma data.

PRIVACIDADE: nenhum dado sai do circuito usuário–IBGE. A extensão não
solicita nenhuma permissão do navegador e não armazena nada; todos os
arquivos são gerados localmente e salvos pelo mecanismo padrão de
download do Chrome. A única chamada de rede é a consulta opcional do
Guia + Mapa ao próprio servidor do SIGC (mesma sessão do usuário),
acionada por clique e confirmação — nada é enviado a terceiros nem ao
desenvolvedor. Isso é verificado automaticamente a cada alteração no
código-fonte (veja o repositório).

AVISO: projeto independente, sem vínculo oficial com o IBGE. Protótipo
para uso e demonstração à equipe de desenvolvimento do SIGC. Use por sua
conta e risco.

Código-fonte aberto: https://github.com/leoniedu/sigc-pro
```

## Single purpose (dashboard field)

```
Adds unofficial productivity tools to SIGC (IBGE) pages: export buttons
(PDF, KML, CSV) on report tables and Agenda helpers (CSV export, slot
checks, printable day guide, date picker), without modifying the
portal's native features.
```

## Host permission justification (dashboard field)

```
The extension injects a content script only on pages of the SIGC portal
(Sistema Integrado de Gestão da Coleta, IBGE) — matched by
`portalweb.ibge.gov.br`, `portalweb2.ibge.gov.br`, and
`w3sigcpns2025.ibge.gov.br`, the specific hosts SIGC is served from,
not the whole ibge.gov.br domain — to add
export buttons (PDF, KML, CSV) to report toolbars
and Agenda helpers (CSV export, slot checks, printable day guide, date
picker), reading data already rendered on the page. No access to any
other site is requested. No browser permissions (storage, tabs, etc.)
are declared — the extension stores no data and makes no network calls,
except one optional, click-and-confirm request made by the "Guia +
Mapa" feature to the SIGC server itself (same origin, within the user's
existing session); nothing is ever sent to third parties or the
developer.
```

## Category

Productivity (or "Tools" if available for the target region)

## Screenshots needed (1280x800 or 640x400, at least 1, up to 5)

1. Toolbar close-up: native buttons + PDF-pro/KML-pro/CSV-pro side by side
   (already captured informally during development — recreate cleanly).
2. PDF-pro output: listagem-style PDF page.
3. KML-pro output: opened in Google Earth showing colored placemarks.
4. (optional) CSV-pro output opened in Excel/Sheets.
5. (optional) Agenda toolbar with CSV-PRO / Verificar Slots / Guia do
   Dia buttons, or the generated day guide with its tabs.

## Privacy policy URL

https://leoniedu.github.io/sigc-pro/PRIVACY_POLICY.html

## Store visibility

Unlisted (installable only via direct link, not searchable).
