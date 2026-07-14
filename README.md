# SIGC-PRO

Extensão de navegador (Chrome, Manifest V3) com melhorias **não oficiais**
para o SIGC — Sistema Integrado de Gestão da Coleta (IBGE), no espírito do
[SEI-PRO](https://sei-pro.github.io/sei-pro/) para o SEI.

> ⚠️ **Aviso:** projeto independente, sem vínculo com o IBGE. As
> funcionalidades são protótipos para demonstração à equipe de
> desenvolvimento oficial do SIGC. Use por sua conta e risco.

## Funcionalidades

Na **Lista de Endereços** (PNS 2026):

- **Botão PDF+KML** — novo botão azul ao lado dos botões de exportação.
  Um clique baixa dois arquivos:
  - **PDF melhorado** — oculta colunas pouco úteis em campo, usa um título
    customizado e move colunas de valor constante (Controle, Biomarcadores,
    Nome ZONA) para uma linha de subtítulo;
  - **KML** (Google Earth / Maps) — endereços com camadas separadas para
    **Selecionado = Sim** (verde) e **Não** (vermelho); coordenadas em
    GMS (`gg mm ss.sss S`) são convertidas automaticamente; endereços sem
    coordenadas válidas são contados e informados.

O botão de PDF original do SIGC continua intocado — gera o PDF padrão,
sem alterações.

A extensão só age em páginas do SIGC (detectadas pelo cabeçalho
`SIGC - PNS2026`) e valida o layout da tabela antes de qualquer alteração —
em qualquer outra página do domínio `ibge.gov.br` ela permanece inativa.

## Instalação (modo desenvolvedor)

1. Baixe este repositório (`Code > Download ZIP`) e descompacte, ou
   `git clone`.
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta `extension/`
   deste repositório.
5. Abra a Lista de Endereços no SIGC e exporte o PDF ou clique no botão
   **KML**.

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
