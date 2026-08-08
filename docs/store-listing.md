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
• Agenda-pro — anota cada domicílio com a data e hora da entrevista
  agendada, a situação e o tipo de entrevista do último movimento, e
  mostra os slots livres de cada zona por turno (Manhã/Tarde) nas
  próximas 2 semanas, com os horários abertos listados dia a dia; os
  endereços viram links para o Google Maps quando há coordenadas.
  Tudo obtido do próprio servidor do SIGC mediante clique e confirmação.

Em qualquer relatório com tabela:
• CSV-pro — exporta a tabela como CSV (todas as páginas, pronto para o
  Excel brasileiro), contornando um problema conhecido do portal que
  impede o download pelos botões nativos de CSV/Excel fora da rede VPN.

No relatório Último Movimento, com um flag avançado ativado nas Opções
da extensão:
• CSV TODAS — exporta o relatório de todas as agências da UF atual
  (não só a selecionada na tela) em um único CSV, uma requisição por
  agência ao próprio servidor do SIGC.

Em Administrar Agenda:
• CSV-PRO — exporta os slots do calendário (dia/semana em exibição) com
  Controle, Domicílio, nome, endereço, telefone etc. já separados em
  colunas.
• Verificar Slots — alerta sobre slots abertos agendados dentro do prazo
  mínimo de agendamento e sobre zonas cujo nome não corresponde à equipe.
• Slots Abertos — na visão Semana, um painel com a tabela zona × turno
  dos slots ainda abertos sobre o total de cada zona, para decidir onde
  há capacidade a abrir.
• Guia do Dia — guia HTML autônomo com abas: resumo do dia (com grade
  horário × equipe dos slots), aba Lab compartilhável com o laboratório
  (hora, nome, município e zona por slot, sem Controle nem domicílio)
  e, por equipe, os cartões de cada visita — pronto para imprimir por
  aba. Ao clicar, oferece obter do próprio servidor do SIGC (mediante
  confirmação) as coordenadas, a zona real, a agência e o entrevistador
  de cada visita, para incluir também o mapa da rota do dia, link de
  navegação por visita e seleção de paradas por checkbox (até 9 por
  rota, com link do Google Maps atualizado em tempo real); recusando a
  consulta, o guia é gerado do mesmo jeito, sem esses dados extras.
• Seletor de data — botão de calendário para pular direto a uma data.

PRIVACIDADE: nenhum dado sai do circuito usuário–IBGE. A extensão
solicita apenas a permissão "storage" do navegador, usada só para
lembrar o estado do flag avançado acima (Opções da extensão); todos os
arquivos são gerados localmente e salvos pelo mecanismo padrão de
download do Chrome. As únicas chamadas de rede são as consultas
opcionais do Guia do Dia, da anotação da Lista de Endereços e da
exportação avançada do Último Movimento, todas ao próprio servidor do
SIGC (mesma sessão do usuário), acionadas
por clique e confirmação. Os arquivos gerados contêm links para o
Google Maps nos endereços (quando há coordenadas), que são links, não
recursos carregados — nada é buscado ao abrir o arquivo, e a navegação
só ocorre ao clicar. Nada é enviado a terceiros nem ao desenvolvedor.
Isso é verificado automaticamente a cada alteração no código-fonte
(veja o repositório).

AVISO: projeto independente, sem vínculo oficial com o IBGE. Protótipo
para uso e demonstração à equipe de desenvolvimento do SIGC. Use por sua
conta e risco.

O QUE HÁ DE NOVO (desde a v0.2.103, última versão publicada na Chrome
Web Store, até a v0.2.126): cartões de visita do Guia do Dia passam a
mostrar Agência e Entrevistador; Guia do Dia sem os cartões LIVRE nem
a linha-resumo de Zonas; correção do relatório Último Movimento após
mudança de endpoint no SIGC (afetava CSV TODAS, a anotação do
Agenda-pro e o Guia do Dia); correção do Entrevistador no Agenda-pro,
que podia se repetir entre domicílios de um mesmo Controle. Histórico
completo:
https://github.com/leoniedu/sigc-pro/blob/main/docs/CHANGELOG.md

Código-fonte aberto: https://github.com/leoniedu/sigc-pro
```

## Single purpose (dashboard field)

```
Adds unofficial productivity tools to SIGC (IBGE) pages: export buttons
(PDF, KML, CSV) on report tables and Agenda helpers (CSV export, slot
checks, open-slot capacity panel, printable day guide, date picker),
without modifying the portal's native features.
```

## Host permission justification (dashboard field)

```
Injects a content script only on the SIGC portal (Sistema Integrado
de Gestão da Coleta, IBGE) — matched by `portalweb.ibge.gov.br`,
`portalweb2.ibge.gov.br`, and `w3sigcpns2025.ibge.gov.br`, the
specific SIGC hosts, not all of ibge.gov.br — to add export buttons
(PDF, KML, CSV) to report toolbars and Agenda helpers, reading data
already rendered on the page. No other site is accessed. The only
permission declared is `storage`, remembering the on/off state of one
advanced, off-by-default flag (Options page) gating a bulk export; no
other data is stored. No network calls except three optional,
click-and-confirm, same-origin requests to the SIGC server: "Guia do
Dia"; the Lista de Endereços annotation (agenda slots + último
movimento for the shown Controle); and, with the flag on, a bulk
"Último Movimento" export looping per agência in the UF. Exported
files may link to Google Maps (not loaded, only fetched on click).
Nothing is sent to third parties or the developer.
```

## Storage permission justification (dashboard field)

```
The extension uses chrome.storage.local to persist a single
on/off flag: the "CSV TODAS" advanced export feature on the
Último Movimento report. The flag is off by default and can only
be toggled on the extension's own Options page
(chrome://extensions → Opções). No other data is stored — no
user preferences, no credentials, no cached responses, no
analytics. The flag exists because the feature loops one
same-origin request per agência in the current UF, which is
deliberately noisy; requiring an explicit opt-in prevents
accidental activation.
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
