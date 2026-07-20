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
  Excel pt-BR), contornando um bug do portalweb: os botões nativos de CSV e
  Excel lançam um erro (`MouseEvent`) da proteção anti-bot F5 do portal fora
  da VPN — o CSV-pro lê os dados diretamente via API do DataTables, sem
  depender desses botões.

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
  **Lab** compartilhável com o laboratório (Controle truncado a 11
  dígitos, sem Domicílio nem outros dados pessoais) e uma aba por equipe
  com um cartão por visita (endereço, morador, telefone, Controle/
  Domicílio, observações) e os horários livres. Ctrl+P na aba imprime só
  aquela página.
- **Guia + Mapa** (opcional) — o mesmo guia, enriquecido: mediante clique
  e confirmação, consulta o próprio servidor do SIGC para obter a zona
  real de cada visita e as coordenadas; cada cartão de visita ganha um
  link para o Google Maps (rota até o endereço), cada equipe ganha um
  link de rota Google Maps encadeando todas as suas visitas do dia (a
  partir de duas visitas), e cada aba (exceto Lab) ganha um mapa-esquema
  em SVG da rota do dia — sem imagens externas, visitas numeradas na
  ordem de horário, uma cor por equipe.

Os botões nativos de PDF/CSV/Excel do SIGC continuam intocados e visíveis —
o PDF nativo funciona normalmente; CSV/Excel nativos funcionam pela VPN e
podem voltar a funcionar fora dela quando o IBGE corrigir o bug.

PDF-pro e KML-pro só agem na Lista de Endereços (detectada pelo cabeçalho
`SIGC - PNS2026` + título da página) e validam o layout da tabela antes de
qualquer leitura — em qualquer outra página do SIGC eles permanecem
inativos. A extensão só injeta seus scripts nos domínios do SIGC
(`portalweb.ibge.gov.br`, `portalweb2.ibge.gov.br` e
`w3sigcpns2025.ibge.gov.br`), nunca em outras
páginas do IBGE. CSV-pro (relatórios) não depende do layout de nenhuma
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

Não há tela de opções: os ajustes (colunas mantidas no PDF, colunas
promovidas ao subtítulo, título) ficam em
`extension/common/sigc-common.js`, na entrada da pesquisa em `PESQUISAS`.
Novas pesquisas são adicionadas como novas entradas no mesmo formato.

## Privacidade

**Nenhum dado sai do seu computador.** A extensão não solicita nenhuma
permissão do navegador, não faz chamadas de rede — exceto o recurso opcional "Guia + Mapa", que consulta o próprio servidor do SIGC mediante clique e confirmação (nada vai a terceiros), não armazena nada
(nem `localStorage`) e não tem código remoto — o arquivo KML é gerado em
memória e salvo localmente. Detalhes em
[PRIVACY_POLICY](docs/PRIVACY_POLICY.html).

Essa garantia é verificada por um *gate* automático
(`scripts/check-privacy.sh`): um hook de pre-commit bloqueia qualquer commit
que introduza APIs de rede ou armazenamento em `extension/` (exceção única e auditada: `fetch` em `features/agenda-map/`, que não pode conter URLs absolutas). Para ativá-lo
após clonar o repositório:

```sh
git config core.hooksPath .githooks
```

## Licença

MIT.
