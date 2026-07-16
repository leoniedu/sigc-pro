# SIGC-PRO

Extensão de navegador (Chrome, Manifest V3) com melhorias **não oficiais**
para o SIGC — Sistema Integrado de Gestão da Coleta (IBGE), no espírito do
[SEI-PRO](https://sei-pro.github.io/sei-pro/) para o SEI.

> ⚠️ **Aviso:** projeto independente, sem vínculo com o IBGE. As
> funcionalidades são protótipos para demonstração à equipe de
> desenvolvimento oficial do SIGC. Use por sua conta e risco.

## Funcionalidades

Três botões azuis, menores que os nativos, adicionados ao lado dos botões de
exportação existentes:

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

Os botões nativos de PDF/CSV/Excel do SIGC continuam intocados e visíveis —
o PDF nativo funciona normalmente; CSV/Excel nativos funcionam pela VPN e
podem voltar a funcionar fora dela quando o IBGE corrigir o bug.

PDF-pro e KML-pro só agem na Lista de Endereços (detectada pelo cabeçalho
`SIGC - PNS2026` + título da página) e validam o layout da tabela antes de
qualquer leitura — em qualquer outra página do domínio `ibge.gov.br` eles
permanecem inativos. CSV-pro não depende do layout de nenhuma pesquisa
específica e ativa em qualquer relatório com tabela.

## Instalação (modo desenvolvedor)

1. Baixe [`dist/sigc-pro-extension.zip`](dist/sigc-pro-extension.zip)
   (sempre atualizado a cada commit) e descompacte — ou baixe o repositório
   inteiro (`Code > Download ZIP`) / `git clone`.
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta `extension/`
   deste repositório.
5. Abra a Lista de Endereços (ou outro relatório) no SIGC e clique em
   **PDF-pro**, **KML-pro** ou **CSV-pro**.

Requer Chrome 111 ou superior.

## Configuração

Não há tela de opções: os ajustes (colunas mantidas no PDF, colunas
promovidas ao subtítulo, título) ficam em
`extension/common/sigc-common.js`, na entrada da pesquisa em `PESQUISAS`.
Novas pesquisas são adicionadas como novas entradas no mesmo formato.

## Privacidade

**Nenhum dado sai do seu computador.** A extensão não solicita nenhuma
permissão do navegador, não faz nenhuma chamada de rede, não armazena nada
(nem `localStorage`) e não tem código remoto — o arquivo KML é gerado em
memória e salvo localmente. Detalhes em
[PRIVACY_POLICY](docs/PRIVACY_POLICY.html).

Essa garantia é verificada por um *gate* automático
(`scripts/check-privacy.sh`): um hook de pre-commit bloqueia qualquer commit
que introduza APIs de rede ou armazenamento em `extension/`. Para ativá-lo
após clonar o repositório:

```sh
git config core.hooksPath .githooks
```

## Licença

MIT.
