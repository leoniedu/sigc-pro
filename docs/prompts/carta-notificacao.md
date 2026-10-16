# Prompt — Carta de notificação (PDF editável) no MAPA-PRO

Implement a new SIGC-PRO feature: a **Carta** button on every row of the
**Domicílios** tab of the MAPA-PRO panel (Último Movimento and Relatório de
Acompanhamento de Biomarcadores). Clicking it downloads a one-page A4 PDF,
`carta_<controle>_<domicilio>.pdf`, a notification letter to the resident of
that household, prefilled from live SIGC data, with every variable part left
as an **editable AcroForm text field**.

Read first: `README.md`, `ROADMAP.md`, `scripts/check-privacy.sh`,
`docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md` (the
vendored-library relay pattern) and
`docs/superpowers/specs/2026-08-08-fix-entrevistador-per-domicilio-design.md`
(who holds a household) and `extension/features/agenda-lookups/agenda-lookups.js`
(`postRelatorio`: the gateway fetch shape, including `referrer`). Follow the house conventions: MAIN-world feature
scripts, no permissions, no storage, no network beyond same-origin SIGC
requests in sanctioned directories, pt-BR UI strings, bun tests under
`tests/`, a design spec under `docs/superpowers/specs/`, LEIA-ME and README
updated, version bump by the pre-commit hook.

## Why

Supervisors leave a printed notice at households that several visits failed
to reach. Today the letter is produced outside SIGC from a nightly data
snapshot, so the agent named on it drifts. The panel already has the live
holder of every household and the address of the filtered recorte; the
letter belongs there.

## Data per row (all already in the panel, or one lookup away)

| Field | Source |
|---|---|
| controle, domicilio | the row |
| logradouro, número, complemento, bairro | `enderecosMap` (Lista de Endereços of the recorte, `extension/common/sigc-common.js` PESQUISAS columns). Número `0`/empty → `S/N`; a complemento starting with `SN ` drops that token (it repeats the missing number) |
| município | `extension/common/municipios.js` from the first 7 digits of the controle; it yields `MUNICÍPIO - UF`, reformat to `Nome/UF` with the name title-cased |
| agência | the report row's Agência (comDemanda) or, when the filter has an `IdAgencia`, the selected option's text in the filter's agência select; blank if neither |
| biomarcadores | Lista de Endereços column `Biomarcadores` (`Sim`/`Não`); decides whether the letter mentions the lab stage |
| agente: siape, nome | the row's Entrevistador, `"<siape> - NOME"`; the same value the Entrevistadores tab groups by |
| agente: função, e-mail, telefone/celular | **new**: the usuário record, see below |

Title-case the address and the agent name for the letter (the portal
stores upper case). Port the Portuguese rules of
`orce::ToTitleCasePT` (lower-case particles: de, da, do, das, dos, e, em,
com, para…) and keep standalone Roman numerals upper (`Urbis I`,
`Quadra II`). Phone: `+557190000000` → `(71) 9000-0000`,
`+5571990000000` → `(71) 99000-0000`; anything else verbatim.

## Usuário lookup (new, same-origin, sanctioned)

Two requests to the SIGC usuário module, host `w3servicosigc.ibge.gov.br`
behind the same F5 gateway the page uses (`fetchViaGateway` in
`extension/common/sigc-common.js` derives the `f5-w-<hex>$$` prefix from
`location.pathname`; the usuário module sits on a **different** backend
host from the report, so build its prefix from that host's hex instead.
The hex is the origin `https://w3servicosigc.ibge.gov.br` as lowercase hex
(same encoding `f5Prefix` decodes). The request still goes to
`location.origin`; this is not a third-party URL. Say so in the spec and
make the privacy-gate self-test cover it).

`check-privacy.sh` forbids any `https://` literal in a fetch directory, so
do **not** write the origin as a URL in the feature: put the precomputed
hex string in a named constant in `extension/common/sigc-common.js`
(`extension/common` is exempt from the URL check) with a comment giving
the origin it decodes to, and a test that decodes it.

The module `codigoPesquisa` is `PNS2025` (verified live; it differs from
the report's PNS2026). Keep it as one named constant next to the hex.

Both requests set the referrer with the fetch init option `referrer:`
(a same-origin URL: `location.origin` + the usuário prefix + the path
below), never a `Referer` header, which is a forbidden header name and is
silently dropped. See `postRelatorio` in agenda-lookups.

1. **siape → id.** `POST /usuario/Grid` with
   `X-Requested-With: XMLHttpRequest`, referrer `<usuário base>/usuario/?codigoPesquisa=PNS2025`,
   body `CodigoPesquisa=PNS2025&Nome=&IdUFSelecionada=&IdPostoSelecionado=&IdFuncaoSelecionada=&Patrimonio=&UnidadeTrabalho=&Login=<siape>&StatusUsuario=true`.
   The response is an HTML table (Nome / Matrícula / UF / Função / …), not
   JSON. Read the first `tbody tr`; map cells by `thead th` text, never by
   position (action columns appear or not depending on the viewer's
   permission). The user **id** is not a column: it is the `value` of the
   row's action `<button>`s (all carry the same value). Matrícula is the
   siape and is rejected where an IdUsuario is expected. Empty table →
   unknown siape.
2. **id → cadastro.** `GET /usuario/EditarUsuario?codigoPesquisa=PNS2025&id=<id>`
   with `X-Requested-With: XMLHttpRequest` and the same referrer. Capture a
   real response in the browser first and write the parser against its
   actual markup; expect a form with inputs for nome, login (siape),
   e-mail, telefone/celular, função and posto/agência. Save a sanitized
   copy as a test fixture. Read field values by input `name`/`id`, with a
   label-text fallback; missing fields are blank, never an error.

Cache both steps **in memory per siape for 60 seconds** (a `Map` of
`{at, record}`; page lifetime, no storage). The lookup lives in its own
fetch-sanctioned directory, `extension/features/usuario-lookup/` (fetch
dirs may not contain `.src =`, and local-resource dirs may not contain
`fetch(`, so the lookup and the PDF feature cannot share a directory).
It exposes one MAIN-world global the carta feature calls. The lookup runs on click, one
siape per click; never prefetch for the whole table. Failure of either
request still produces the letter, with nome and siape from the row and
the other agent fields blank, plus a one-line toast saying the cadastro
could not be read.

## PDF generation

Vendor **pdf-lib** (`pdf-lib.min.js`, pinned version, unmodified) under
`extension/vendor/pdf-lib/`, loaded the way Leaflet is: the ISOLATED-world
relay writes `chrome.runtime.getURL(...)` into a `data-` attribute on
`<html>`, the MAIN-world feature injects a `<script src>` from it on first
use, as `el.src = urls.jsUrl;` (the exact shape
`LOCAL_RESOURCE_PROP_OK` in `check-privacy.sh` accepts). Add the path to
`web_accessible_resources` and the carta feature directory to
`LOCAL_RESOURCE_DIRS` in `check-privacy.sh`. pdfMake, which the page already loads, cannot create
form fields, which is why pdf-lib is needed.

Draw the letter with pdf-lib from scratch (no template PDF):
`StandardFonts.Helvetica` and `HelveticaBold`, A4, margins 2.2 cm sides,
1.6 cm top, 1.8 cm bottom. Two images, embedded as base64 PNGs in
`extension/vendor/carta-assets/carta-assets.js` (a script that sets one
global, loaded through the same relay/`.jsUrl` pattern): the IBGE logo
with the "Instituto Brasileiro de Geografia e Estatística" wordmark
(about 1400×370 px, rendered 6.2 cm wide) and the Brasão da República
(about 512 px square, rendered 1.9 cm high). Source files: ask for the
SVGs from the pns.zonas letter (`docs/carta_notificacao_assets/`) and
rasterize them at those sizes; do not fetch anything. Create **text fields** with
`form.createTextField(name)`, 10 pt Helvetica, dark blue `#004282`,
no border, and set each field's value. The static text is black. The
whole letter must fit one page with the longest realistic values
(address 60 chars, complemento 60 chars, name 40 chars). The standard
fonts are WinAnsi-encoded: pt-BR accents, `—` and `·` encode; anything
outside Latin-1 throws, so keep the text to WinAnsi and assert in a test
that every static string and field default encodes.

Field names, exactly: `saudacao`, `endereco`, `complemento`, `bairro`,
`municipio`, `controle`, `domicilio`, `nome`, `siape`, `cargo_descricao`,
`celular_pessoal`, `email_institucional`, `agencia_descricao`.

## Layout, top to bottom

1. **Letterhead**: IBGE logo left, bottom-aligned; bold blue
   `SUPERINTENDÊNCIA ESTADUAL DO IBGE <prep> <UF>` right, bottom-aligned;
   a 1.2 pt blue rule under both.
2. **Brasão** left with **`SERVIÇO PÚBLICO FEDERAL`** bold 9 pt beside it,
   vertically centred; a red-bordered **`URGENTE`** box (20 pt bold red,
   2 pt red border) right.
3. **Title** centered, bold blue 13 pt: `NOTIFICAÇÃO — PESQUISA NACIONAL DE
   SAÚDE 2026`.
4. **Destinatário block**, a 2 pt blue left rule, grey labels, two
   columns. Left: Endereço, Complemento, Bairro, Município (fields).
   Right: Controle, Domicílio (fields).
5. **Greeting**: field `saudacao`, bold 11 pt black, default
   `Prezado(a) morador(a),`.
6. **Body**, 11 pt justified, the text below.
7. **Agent box**, centered, 78% width, light blue fill `#f2f6fb`, 1 pt blue
   border, grey labels: Nome, Matrícula, Cargo, Telefone, E-mail, Agência
   (fields).
8. **Closing**: `Atenciosamente,` then, bold, `Superintendência Estadual do
   IBGE <prep> <UF>`. **No signature, no person's name**: the letter is
   signed on paper, or stamped, by whoever issues it.
9. **Footer**: thin blue rule, `Superintendência Estadual do IBGE <prep>
   <UF>` left, `www.ibge.gov.br · 0800 721 8181` right, 8 pt grey.

## Letter text (pt-BR, verbatim; `**` = bold)

Paragraph 2 has two variants, chosen by the household's Biomarcadores flag.

> Seu domicílio foi selecionado para a Pesquisa Nacional de Saúde (**PNS**)
> 2026, realizada pelo IBGE em parceria com o Ministério da Saúde. Após
> várias tentativas, ainda não conseguimos realizar a entrevista neste
> endereço. A coleta vai de julho a novembro, e precisamos concluir a sua
> entrevista **com urgência**.
>
> *(Biomarcadores = Sim)* A participação tem duas etapas: a entrevista e,
> com o seu consentimento, uma coleta de sangue e urina feita por
> profissionais de laboratório parceiro do IBGE.
>
> *(Biomarcadores = Não ou desconhecido)* A participação consiste em uma
> entrevista com o questionário da pesquisa, feita por um(a) Agente de
> Pesquisa do IBGE.
>
> A legislação federal determina a **obrigatoriedade de prestar as
> informações** solicitadas pelo IBGE e assegura o **sigilo**: os dados são
> usados exclusivamente para fins estatísticos, nenhum dado que permita
> identificar o informante é divulgado ou compartilhado com outros órgãos,
> e as informações não podem servir de prova em processo administrativo,
> fiscal ou judicial (Decreto-Lei nº 161/1967; Lei nº 5.534/1968; Lei nº
> 5.878/1973).
>
> Podemos voltar **à noite ou no fim de semana**, ou no horário que for melhor
> para você. Entre em contato com o(a) agente abaixo o quanto antes para
> **agendar a entrevista**. A identidade dos nossos profissionais pode ser
> conferida em **respondendo.ibge.gov.br** ou pelo **0800 721 8181**.
>
> **Você é fundamental para o conhecimento do País.**

The word wrapper splits on spaces only, so `Decreto-Lei` (plain hyphen;
U+2011 is not WinAnsi) never breaks at the hyphen. Keep `2026` and
`julho a novembro` as named constants next to `PESQUISAS`, not inline
literals.

## `<prep> <UF>` — the superintendência name by UF

The UF is the first 2 digits of the row's controle (the filter's `IdUf`
can be a wildcard; use it only as a fallback when the controle is
missing). Map to the state name with its preposition; the phrase is `Superintendência Estadual
do IBGE` + this:

| | | | |
|---|---|---|---|
| 11 em Rondônia | 12 no Acre | 13 no Amazonas | 14 em Roraima |
| 15 no Pará | 16 no Amapá | 17 no Tocantins | 21 no Maranhão |
| 22 no Piauí | 23 no Ceará | 24 no Rio Grande do Norte | 25 na Paraíba |
| 26 em Pernambuco | 27 em Alagoas | 28 em Sergipe | 29 na Bahia |
| 31 em Minas Gerais | 32 no Espírito Santo | 33 no Rio de Janeiro | 35 em São Paulo |
| 41 no Paraná | 42 em Santa Catarina | 43 no Rio Grande do Sul | 50 em Mato Grosso do Sul |
| 51 em Mato Grosso | 52 em Goiás | 53 no Distrito Federal | |

Unknown code → `Superintendência Estadual do IBGE` alone.

## Button and UX

- A small blue `Carta` button in a new last column of the Domicílios
  table, both variants, excluded from the CSV like the pin column.
- Click: look up the agent (cached), build, download. Status line in the
  panel toolbar: `Gerando carta <controle>/<dom>…` then
  `Carta <controle>/<dom> gerada para <nome>` or `… gerada sem agente`.
- A household with no address in `enderecosMap` still gets a letter with
  the address fields blank and a toast saying so.
- No batch button. No viewer. One click, one file.

## Tests (bun, happy-dom)

- Grid parser: fixture with and without action columns; id from button
  `value`; empty table → null.
- EditarUsuario parser: the captured fixture; missing inputs → blanks.
- Cache: second call within 60 s makes no request; after 60 s it does.
- Title case and phone formatting tables (include `S/N`, `Urbis I`,
  `Rua Silveira Martins 3200`, `Alexandre Silva de Santana`).
- Prepositions: every code in the table above, plus an unknown one.
- PDF: generate for a fixture row, reload with pdf-lib, assert the 13
  field names and values, one page, A4; both paragraph-2 variants.
- Privacy gate self-test: the new fetch directory and the vendored
  `.jsUrl` pattern pass; an absolute `https://` URL in the new directory
  fails.

## Deliverables

- `extension/features/carta-notificacao/` (button, PDF; add it to
  `LOCAL_RESOURCE_DIRS` in `check-privacy.sh`) and
  `extension/features/usuario-lookup/` (add it to `FETCH_DIRS` with a
  comment naming the two endpoints), relay change,
  `extension/vendor/pdf-lib/`, `extension/vendor/carta-assets/`, manifest
  entries and the load-order test updated for the new scripts.
- Spec `docs/superpowers/specs/<date>-carta-notificacao-design.md`.
- README and LEIA-ME sections, PRIVACY_POLICY paragraph for the two new
  same-origin requests (what is sent: a siape; what comes back: that
  user's cadastro; nothing stored).
- Do not touch the pns.zonas repository.
