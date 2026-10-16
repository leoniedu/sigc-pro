# SIGC-PRO

Extensão de navegador (Chrome, Manifest V3) com melhorias **não oficiais**
para o SIGC — Sistema Integrado de Gestão da Coleta (IBGE), no espírito do
[SEI-PRO](https://sei-pro.github.io/sei-pro/) para o SEI.

> ⚠️ **Aviso:** projeto independente, sem vínculo com o IBGE. As
> funcionalidades são protótipos para demonstração à equipe de
> desenvolvimento oficial do SIGC. Use por sua conta e risco.

## Funcionalidades

Botões azuis, menores que os nativos, adicionados ao lado dos botões
existentes:

Na **Lista de Endereços** (PNS 2026):

- **PDF-pro** — reexporta o PDF no formato listagem clássico do IBGE: oculta
  colunas pouco úteis em campo, usa título customizado e move colunas de
  valor constante (Controle, Situação, Biomarcadores, Zona, nº de
  selecionados) para o cabeçalho.
- **KML-pro** — endereços com camadas separadas para **Selecionado = Sim**
  (vermelho, numerado) e **Não** (azul, menor) — cores seguras para
  daltonismo; coordenadas em GMS (`gg mm ss.sss S`) são convertidas
  automaticamente; endereços sem coordenadas válidas são contados e
  informados.

Em **qualquer relatório do SIGC** com tabela (DataTables):

- **CSV-pro** — exporta a tabela como CSV (`;`-separado, compatível com
  Excel pt-BR), lendo os dados diretamente via API do DataTables.

No relatório **Último Movimento**, filtrado por **agência, município ou
controle** (qualquer um deles basta):

- **MAPA-PRO** — abre um painel com três abas:
  - **Mapa** — os domicílios do recorte filtrado plotados e coloridos por
    zona (cascos convexos por zona, cores seguras para daltonismo), com a
    situação de coleta por marcador e, no popup de cada domicílio, a
    entrevista agendada quando existe. O fundo cartográfico
    (OpenStreetMap) só é carregado após uma confirmação própria.
  - **Zonas** — uma linha por zona do recorte, **inclusive as que ainda
    não tiveram coleta** (semeadas a partir da Lista de Endereços, não do
    relatório): situação de coleta, quantos domicílios estão agendados e
    quantos não, e os horários ainda livres listados dia a dia. Clicar no
    nome da zona a enquadra no mapa.
  - **Domicílios** — a lista completa, ordenável por qualquer coluna, com
    zona, entrevista agendada, situação, tipo e entrevistador — e, em
    cada linha, o botão **Carta**: baixa a **carta de notificação** do
    domicílio em PDF (uma página A4, campos editáveis), já preenchida
    com o endereço da Lista de Endereços, o município, o agente que
    detém o domicílio (coluna Entrevistador) e o cadastro desse agente
    — função, telefone, e-mail — consultado no módulo de usuários do
    SIGC no momento do clique (duas requisições ao próprio servidor por
    matrícula, com cache de 60 s em memória, sem armazenar nada). A
    agência é a da linha do relatório ou a do filtro (lida da lista de
    agências da UF, uma requisição por UF); filtrando por município ou
    controle, fica em branco para quem emite preencher. O módulo de
    usuários tem sessão própria: se ela não estiver iniciada, a
    extensão abre o módulo em uma aba — o navegador faz o login único
    como em qualquer aba — e consulta de novo a cada 2 s, por até 90 s,
    até ele responder; então fecha a aba e gera a carta. Se for preciso
    entrar, a aba mostra o login. A extensão nunca envia credenciais nem
    formulários de autenticação. Se a consulta falhar ou a matrícula não
    existir, a carta sai só com nome e matrícula, e um aviso diz o
    motivo. O texto da carta muda conforme o domicílio está ou não na
    subamostra de biomarcadores, e a superintendência é a da UF do
    controle. Sem assinatura: três linhas em branco e duas linhas
    editáveis (nome de quem assina e a unidade) para quem a entrega.

  As coordenadas (Lista de Endereços do mesmo recorte) e a agenda da UF
  são obtidas do próprio servidor do SIGC mediante clique e confirmação,
  em uma requisição cada, com cache por página. O recorte usado é
  exatamente o filtro que você submeteu no Filtrar — não é preciso ter
  acesso ao seletor de agência.

  Filtros por entrevistador ou tipo de acompanhamento não impedem o mapa,
  desde que combinados com agência, município ou controle. Sem nenhum
  desses três o botão fica visível porém **bloqueado**, com a explicação
  no tooltip e também ao clicar — um relatório de estado inteiro é grande
  demais para buscar coordenadas.

No relatório **Último Movimento**:

- **CSV TODAS** — baixa o relatório Último Movimento de TODAS as agências
  da UF atual (não só a agência filtrada na tela) e combina tudo em um
  único CSV, com IdUf/IdAgencia/AgenciaDescricao adicionados às colunas
  originais. Faz uma requisição por agência, com 2 segundos de intervalo
  entre elas, ao próprio servidor do SIGC — pode levar alguns minutos.
  Uma agência que falhar é pulada (o CSV final é gerado com o restante, e
  um alerta lista quais falharam), não interrompe a exportação inteira.

No relatório **Gerenciamento da Coleta**:

- **GEREN-PRO** — ao lado de Filtrar, abre um painel com a UF
  inteira (os filtros da página não valem; só a UF é lida): abas
  Domicílios, Município e Agência. Município e Agência trazem uma coluna
  por rótulo de "Andamento da Entrevista" do próprio portal (contagem ou
  % da linha) e mantêm separadas as recusas — no questionário, de
  biomarcadores (25A) e do domicílio. "Não iniciada" aparece como "Sem
  entrevista iniciada" (inclui domicílios já encerrados sem entrevista).
  A amostra de biomarcadores se filtra dentro do painel, sem nova
  requisição. Um rótulo que o painel não conhece aparece como "novo",
  nunca é descartado. Uma única
  requisição ao próprio servidor do SIGC; o resultado fica só na memória
  por 5 minutos (botão Atualizar para buscar de novo). CSV por aba.
  A aba **Histórico** mostra a evolução por agência: a cada consulta a
  extensão guarda, no seu navegador, uma foto por UF por dia com as
  contagens por agência (nunca dados de domicílio); as colunas são as
  semanas ISO com consulta (as duas consultas mais recentes dia a dia e, antes, a última de cada semana; um salto aparece
  no cabeçalho, "+3 sem") e a tabela traz uma métrica por vez — ou uma
  agência com todas as métricas, entre elas "Sem entrevista — ainda a
  trabalhar" × "encerrado" e "Ciclo encerrado" × "Bio a coletar". Há
  "Exportar histórico" (CSV diário) e "Limpar histórico".

Em **Administrar Agenda** (qualquer UF/pesquisa cuja URL termine em
`/AdministracaoAgenda`):

- **CSV-PRO** — exporta os slots exibidos no calendário (dia ou semana
  atual, todas as equipes visíveis) como CSV: data, equipe, horário e os
  campos que o SIGC só mostra dentro do texto de cada slot (Controle,
  Domicílio, Nome, Sexo, Dt. Nascimento, Idade, Endereço, Telefone, Zonas,
  Observação), já separados em colunas. Lê o calendário já carregado na
  tela — não busca semanas além da exibida. Inclui tanto slots reservados
  quanto slots abertos (ainda sem endereço atribuído).
- **Verificar Slots** — duas verificações em um clique: slots abertos (sem
  endereço atribuído) agendados antes do prazo mínimo para um novo
  agendamento ser viável (hoje + 3 dias corridos; +4 se hoje for
  sexta-feira) e zonas cujo nome não corresponde à equipe da coluna
  (padrão `UF_Equipe_Local`). Não altera nada, não bloqueia o CSV-PRO —
  é só um alerta sob demanda, na visualização atual.
- **Seletor de data** (🗓️) — ao lado do título do período no topo do
  calendário, abre o seletor de data nativo do navegador e pula
  diretamente para o dia escolhido, sem precisar navegar semana a semana.
- **Guia do Dia** (só na visualização Dia) — baixa um guia HTML autônomo
  e sem dependências (abre de `file://`, sem rede): uma aba Resumo com
  estatísticas do dia e uma grade horário × equipe dos slots, uma aba
  **Lab** compartilhável com o laboratório, na forma como o próprio
  sistema do laboratório lista as coletas (nome e município por slot, sem
  Controle, sem Domicílio e sem data de nascimento) e uma aba por equipe
  com um cartão por visita (endereço, morador, telefone, Controle/
  Domicílio, observações) e os horários livres. Ctrl+P na aba imprime só
  aquela página.
- **Guia + Mapa** (opcional) — o mesmo guia, enriquecido: mediante clique
  e confirmação, consulta o próprio servidor do SIGC para obter a zona
  real de cada visita e as coordenadas; cada cartão de visita ganha um
  link para o Google Maps (rota até o endereço) e um checkbox próprio
  para incluí-la na rota da equipe — a equipe ganha um link de rota
  Google Maps que se atualiza em tempo real conforme os checkboxes são
  marcados/desmarcados (até 9 paradas por rota); a aba Resumo ganha sua
  própria seção "Rota do dia", combinando as visitas de todas as
  equipes, sempre iniciando desmarcada. Cada aba (exceto Lab) também
  ganha um mapa-esquema em SVG da rota do dia — sem imagens externas,
  visitas numeradas na ordem de horário, uma cor por equipe.

Os botões nativos de PDF/CSV/Excel do SIGC continuam intocados e visíveis.

PDF-pro e KML-pro só agem na Lista de Endereços (detectada pelo cabeçalho
`SIGC - PNS2026` + título da página) e validam o layout da tabela antes de
qualquer leitura — em qualquer outra página do SIGC eles permanecem
inativos. A extensão só injeta seus scripts em três hosts:
`w3sigcpns2025.ibge.gov.br` e o portal de acesso (`portalweb.ibge.gov.br`
e `portalweb2.ibge.gov.br`), que também serve outros sistemas do IBGE.
Nesses hosts os scripts carregam em qualquer página, mas cada botão só
aparece onde reconhece a página do SIGC a que se destina. CSV-pro (relatórios) não depende do layout de nenhuma
pesquisa específica e ativa em qualquer relatório com tabela. O CSV-PRO da
Agenda ativa em qualquer página cuja URL termine em `/AdministracaoAgenda`,
também sem depender de pesquisa específica.

## Instalação (modo desenvolvedor)

1. Baixe [`dist/sigc-pro-extension.zip`](dist/sigc-pro-extension.zip)
   (sempre atualizado a cada commit) e descompacte — ou baixe o repositório
   inteiro (`Code > Download ZIP`) / `git clone`.
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta `extension/`
   deste repositório.
5. Abra a Lista de Endereços (ou outro relatório, ou a Agenda) no SIGC e
   clique no botão **PRO** que precisar: **PDF-pro**, **KML-pro**,
   **CSV-pro**, ou, na Agenda, **CSV-PRO**, **Verificar Slots**, o
   seletor de data (🗓️), **Guia do Dia** ou **Guia + Mapa**.

Requer Chrome 111 ou superior.

## Configuração

Colunas mantidas no PDF, colunas promovidas ao subtítulo e título ficam em
`extension/common/sigc-common.js`, na entrada da pesquisa em `PESQUISAS`.
Novas pesquisas são adicionadas como novas entradas no mesmo formato.

A tabela de municípios usada pela aba **Lab** do Guia do Dia
(`extension/common/municipios.js`) é **gerada** — não edite à mão. Ela
mapeia o código IBGE de 7 dígitos (os 7 primeiros dígitos do Controle)
para `MUNICÍPIO - UF`, e é embutida na extensão (nenhuma consulta de
rede). Para regerá-la a partir de `orcedata::municipios`:

```sh
Rscript scripts/gen-municipios.R
```

## Privacidade

**Nenhum dado do SIGC sai do seu computador.** A extensão solicita
**nenhuma permissão** do navegador — a lista `permissions` do manifesto
está vazia — e não faz chamadas de rede, exceto quatro recursos opcionais, todos mediante clique,
todos apenas ao próprio servidor do SIGC: "Guia + Mapa"
(coordenadas de endereços), "MAPA-PRO" (Lista de Endereços do recorte
filtrado + agenda da UF), a exportação Último Movimento
multi-agência (que confirma, nomeando quantas agências serão consultadas)
e a "Carta" do MAPA-PRO (o cadastro do agente — função, telefone, e-mail,
agência — pela matrícula, no módulo de usuários do SIGC, uma por clique,
sem confirmação porque não há consulta em massa). Fora esses quatro casos a extensão não tem
código remoto — o arquivo KML, por exemplo, é gerado em memória e salvo
localmente. Toda requisição da extensão leva o cabeçalho `X-SIGC-PRO` com
a versão instalada, para que o SIGC possa distingui-la das ações do
próprio usuário.

**O que a extensão guarda.** Uma única coisa, no próprio navegador: o
histórico do GEREN-PRO. A cada consulta ela grava uma foto por UF por dia
com as **contagens por agência** (quantos domicílios em cada andamento do
portal, com ou sem amostra Bio) — nunca Controle, domicílio, nome ou
endereço. Serve à aba Histórico; o botão "Limpar histórico" apaga tudo e
"Exportar histórico" gera uma cópia em CSV. Nada disso é enviado a alguém.

O único recurso de terceiros em toda a extensão é o fundo cartográfico do
MAPA-PRO: as imagens de mapa (tiles) do OpenStreetMap, buscadas somente
após uma confirmação própria e separada da consulta de dados. Nenhum dado
do SIGC acompanha esse pedido, e o Leaflet — como o pdf-lib e as
imagens do timbre da carta — é distribuído dentro da
extensão (`extension/vendor/`), não carregado de um CDN. Detalhes em
[PRIVACY_POLICY](docs/PRIVACY_POLICY.html).

Essa garantia é verificada por um *gate* automático
(`scripts/check-privacy.sh`): um hook de pre-commit bloqueia qualquer commit
que introduza APIs de rede ou armazenamento em `extension/` fora de
exceções únicas e auditadas: `fetch` em `common/`,
`features/agenda-lookups/`, `features/ultimo-movimento-export/` e
`features/usuario-lookup/`, sem URLs absolutas — exceto, em `common/`,
uma lista fechada: o host do módulo de usuários do SIGC e os links do
Google Maps; URLs codificadas (hex ou base64) reprovam em qualquer lugar;
`chrome.storage` em lugar nenhum (banido globalmente) e `IndexedDB` somente
em `features/gerenciamento-historico/` (sem rede nenhuma); carregamento de
scripts da própria extensão (Leaflet, pdf-lib, imagens da carta) só em
`features/ultimo-movimento-map/` e `features/carta-notificacao/`; e, em
`features/ultimo-movimento-map/`, exatamente uma URL absoluta — o
template de tiles do OpenStreetMap. Qualquer outra URL externa, ali ou
em qualquer outro lugar, reprova o gate. Para ativá-lo
após clonar o repositório:

```sh
git config core.hooksPath .githooks
```

## Licença

MIT.
