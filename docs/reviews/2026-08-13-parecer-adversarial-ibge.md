# Parecer adversarial — SIGC-PRO

> ## ⚠️ DOCUMENTO DE REVISÃO ADVERSARIAL — NÃO É UM PARECER OFICIAL DO IBGE
>
> Este documento é um **exercício de red team**, escrito a pedido do autor da
> extensão. Foi produzido por um assistente de IA (Claude) **encenando o papel**
> de um especialista do IBGE — desenvolvedor do SIGC e responsável por segurança
> da informação — instruído a ser adversarial.
>
> **O que este documento NÃO é:**
> - não é a posição do IBGE, nem de qualquer servidor ou área do IBGE;
> - não foi solicitado, revisado ou endossado por ninguém no IBGE;
> - não é parecer jurídico, nem de proteção de dados;
> - não constitui autorização nem vedação de uso.
>
> **Para que serve:** antecipar, antes de qualquer conversa institucional, as
> objeções mais duras que uma avaliação real poderia levantar — para que sejam
> respondidas com evidência em vez de improviso. As citações da LGPD e da Lei
> 5.534/1968 são o enquadramento que um avaliador provavelmente usaria, não uma
> análise jurídica.
>
> Uma avaliação real exige o Encarregado de Dados (DPO) e a área técnica do
> SIGC, com acesso a contexto que este documento não tem.

---

## Objeto da revisão

| | |
|---|---|
| **Versão revisada** | **0.2.174** (`extension/manifest.json`) |
| **Commit** | `772248d` |
| **Data** | 2026-08-13 |
| **Escopo** | código em `extension/` (~5.680 linhas), manifest, documentação ao usuário (`README.md`, `LEIA-ME.txt`, `docs/store-listing.md`, `docs/PRIVACY_POLICY.html`) |
| **Suíte de testes no momento da revisão** | 327 testes, 0 falhas |
| **Não revisado** | comportamento em produção contra o SIGC real; dependência `extension/vendor/leaflet/` (147 KB, não auditada linha a linha) |

Esta revisão foi conduzida em várias rodadas, com o autor contestando
conclusões. **Várias objeções iniciais foram retiradas** por serem factualmente
erradas. As retratações estão registradas na seção 6 — deliberadamente, porque
um parecer que só acumula objeções é menos útil que um que mostra quais não
sobreviveram ao contraditório.

---

## 1. Sumário executivo

O código tem qualidade acima da média: falha fechado, valida layout antes de
agir, mantém dados apenas em memória, descarta PII na fronteira de parsing e é
verificado por um *gate* automatizado. Nada aqui questiona a competência ou a
boa-fé do autor.

**Achado mais importante, e favorável:** a extensão é **estritamente somente
leitura**. Todos os endpoints consultados são de relatório/consulta
(`relatorio/filtrar`, `RelatorioDistribuicao/Filtrar`,
`AdministracaoAgenda/ObterSlots`). Os POSTs são filtros de relatório — é como
esses endpoints recebem parâmetros. **Não há criação, alteração ou exclusão de
nada no SIGC.** No pior caso a extensão lê algo indevido ou quebra a própria
interface; ela não pode corromper dados. Isso limita o teto do risco: as
preocupações são de confidencialidade e disponibilidade, nunca de integridade.

**Riscos residuais, em ordem de relevância:**

1. Cadeia de atualização não governada (extensão *unlisted*, auto-atualizável, com acesso à sessão autenticada).
2. Auditabilidade: requisições em MAIN world são indistinguíveis das do usuário nos logs do SIGC.
3. *Monkey-patch* em `window.pdfMake`, global da página do SIGC.
4. Acoplamento a detalhes internos (índices de coluna, rótulos, endpoints) que cria um consumidor não contratado da estrutura do SIGC.
5. Escopo: `CSV TODAS` monta um extrato estadual que nenhuma ação nativa isolada produz.

---

## 2. O que foi verificado e está correto

**Somente leitura.** Confirmado por inspeção de todos os `fetch`/POST em
`extension/`. Nenhum endpoint de escrita.

**Sem permissões amplas.** `manifest.json` declara apenas `"permissions":
["storage"]`. **Não há `host_permissions`.** Os content scripts casam com três
hosts específicos do SIGC, não com `ibge.gov.br` inteiro nem `<all_urls>`.

**PII descartada na fronteira.** `parseSlots` (`agenda-lookups.js`) mantém
apenas `start`, `isoDate`, `controle`, `domicilio`, `zonas`, `aberto`. Nome,
endereço e telefone presentes na resposta da agenda **não entram na memória da
extensão** — há teste dedicado a isso.

**Falha fechado em mudança de layout.** `tableMatchesLayout` compara índice
posicional contra rótulo esperado e recusa a operação em caso de divergência,
registrando esperado × obtido no console.

**Armazenamento mínimo.** `chrome.storage` só em `features/settings/`, apenas
para um flag booleano. Consentimentos e caches vivem em memória e somem ao
recarregar.

**Sem código remoto.** Leaflet é distribuído dentro da extensão
(`extension/vendor/leaflet/`), declarado em `web_accessible_resources` e
carregado por `chrome.runtime.getURL`. Compatível com MV3.

**Gate de privacidade automatizado.** `scripts/check-privacy.sh`, em hook de
pre-commit, restringe `fetch` a três diretórios (sem URLs absolutas),
`chrome.storage` a um, e permite **exatamente uma** URL absoluta em
`features/ultimo-movimento-map/` — o template de tiles do OpenStreetMap.
Qualquer outra reprova.

**Ressalva:** o gate roda no repositório do autor. Protege o autor de
regressões próprias; **não prova ao IBGE** que o pacote publicado na Web Store
corresponde ao código do GitHub.

---

## 3. Riscos residuais

### 3.1 Cadeia de atualização (o mais relevante)

Extensão *unlisted* com **atualização automática** pelo Chrome. Uma conta de
desenvolvedor comprometida publica, sem revisão do IBGE, código com acesso
total à sessão autenticada de todos os servidores que a instalaram. Como roda
em MAIN world, esse código teria acesso ao DOM, ao `jQuery` e à sessão.

Não é hipótese sobre o autor; é a propriedade estrutural do canal de
distribuição. É o item que eu trataria como bloqueante em um contexto
corporativo.

**Mitigação:** distribuição por política corporativa com versão fixada e
revisada, em vez de link não listado auto-atualizável.

### 3.2 Auditabilidade

Os scripts rodam em `world: MAIN` e usam `credentials: 'same-origin'`. Para o
servidor, as requisições são **indistinguíveis das ações do usuário**. O SIGC
perde a capacidade de distinguir automação de navegação comum — inclusive para
fins legítimos de suporte e dimensionamento.

**Nota:** a escolha de MAIN world **não é gratuita**. A extensão precisa de
`window.pdfMake`, `window.jQuery` e da instância viva do DataTables — globais
de página, invisíveis de um mundo isolado. E a parte que toca `chrome.storage`
**já está** isolada, via relay MAIN/ISOLATED. A recomendação de "migrar para
ISOLATED" foi retirada por inviabilidade técnica (ver seção 6).

**Mitigação:** cabeçalho identificador nas requisições da extensão. É do
interesse de ambos os lados — dá ao SIGC visibilidade e ao autor a prova de que
a extensão não faz mais do que declara.

### 3.3 Monkey-patch em `window.pdfMake`

`pdf-export.js:196-248` substitui `pdfMake.createPdf` por um wrapper próprio,
permanente durante a vida da página. É a única via disponível: o botão de PDF
do DataTables monta a definição do documento internamente e a entrega direto ao
pdfMake, sem callback ou configuração que permita reescrevê-la antes.

Implementado com cuidado:

- o original é capturado e sempre executa o trabalho real;
- flag `rebuildOnNext` garante que o **botão nativo passa intocado** (primeiro
  branch delega sem reescrever nada);
- `__sigcProPdfTweak` impede duplo wrapping;
- três `try/catch` independentes, todos degradando para "exporta como está";
- recusa explícita quando há múltiplos Controles na tela, em vez de gerar um
  cabeçalho enganoso.

**O que permanece como risco, e é do lado do SIGC:**

- Depois que a extensão carrega, `window.pdfMake.createPdf` **não é a função que
  o SIGC distribuiu**.
- O wrapper tem assinatura `function (doc)`. Se um upgrade do pdfMake
  acrescentar um segundo parâmetro, ele é **silenciosamente descartado**.
  `tableMatchesLayout` não protege contra isso — valida colunas da tabela, não
  a API do pdfMake.
- O par `rebuildOnNext = true; pdfBtn.click()` assume que o caminho do
  DataTables até `createPdf` é **síncrono**. Se esse caminho se tornar
  assíncrono, o flag pode disparar no export errado — falha silenciosa.
- Depurabilidade: diante de um PDF estranho, "há extensão alterando o pdfMake?"
  passa a ser pergunta obrigatória, sem nenhum sinal na página que a sugira.

**Mitigações baratas:** delegar com `function (...args)` /
`originalCreatePdf.apply(this, args)`, eliminando a classe inteira de quebra por
upgrade; e documentar `__sigcProPdfTweak` no README como o ponto a verificar ao
depurar PDF.

### 3.4 Acoplamento a detalhes internos

A extensão depende de índices posicionais (`controle: index 1`, `latitude: 10`
…), de rótulos em português com acento (`"Última Posição"`, `"Domicílio"`), de
`#tableRelatorio`, de `.header-sigc__title`, de `/relatorio/filtrar?slug=` e do
formato do gateway F5 (`f5-h-$$`).

O histórico do próprio repositório mostra que **isso já quebrou**: a coluna
"lupa" deslocou todos os índices; `Data Transmissão` virou `Data`; o endpoint do
Último Movimento mudou de formato.

O efeito para o SIGC é ter um **consumidor não contratado da própria estrutura
interna**. Ao renomear uma coluna, servidores relatam que "o SIGC quebrou" — e o
chamado chega à equipe do SIGC, não ao autor.

Atenuante real: a extensão **falha fechado e ruidosamente**, e o parsing do
Último Movimento tolera acentos e marcadores `#!`. É mais disciplinado que a
maioria das integrações. Mas o modo de falha continua aterrissando no suporte do
SIGC.

### 3.5 Escopo do `CSV TODAS`

Monta um extrato de **todas as agências da UF** em um único arquivo — dataset
que nenhuma ação nativa isolada produz. É questão de governança de dados (quem
deve possuir um extrato estadual), não de carga (ver 6.2). O flag desligado por
padrão é o controle adequado.

### 3.6 Tiles do OpenStreetMap

Único recurso de terceiros. Buscado apenas após confirmação própria e separada;
recusando, as abas Zonas e Domicílios continuam funcionando. Nenhum dado do SIGC
acompanha o pedido.

**Ressalva que a documentação não faz:** o padrão de quadrículas requisitadas
**revela a área geográfica sob levantamento**, com IP institucional
identificável. Irrelevante na maioria dos casos; não em setores sensíveis. Um
basemap servido internamente eliminaria a questão.

*(A documentação da v0.2.174 já corrigiu a afirmação anterior de que nenhum
terceiro era contatado — ver 6.4.)*

### 3.7 Institucional

- **O nome "SIGC-PRO" sugere produto oficial.** O aviso de projeto independente
  está no rodapé; o nome é o que circula informalmente.
- **Distribuição por link** implica propagação sem inventário: não se sabe quem
  usa, em qual versão.
- **A aba "Lab"** monta lista para compartilhar com laboratório (nome, município,
  idade). Compartilhamento externo de dados de pesquisados por planilha merece
  parecer da área de dados — independentemente desta extensão.

---

## 4. Recomendações

**Bloqueantes em contexto corporativo:**

1. Distribuição com versão fixada e revisada, em vez de *unlisted*
   auto-atualizável (3.1).
2. Revisão do **pacote publicado**, não do repositório (2, ressalva do gate).
3. Parecer do Encarregado de Dados sobre a geração local de arquivos com dado
   pessoal sensível — **abrangendo a exportação nativa do SIGC, não apenas a
   extensão** (ver 6.1).

**Recomendados:**

4. Cabeçalho identificador nas requisições (3.2).
5. Delegação `(...args)` no wrapper do pdfMake e documentação do
   `__sigcProPdfTweak` (3.3).
6. Renomear para algo que não use "SIGC" como prefixo de produto (3.7).
7. Basemap interno em vez de OpenStreetMap (3.6).

**Encaminhamento preferível:** várias funções — exportação utilizável, mapa por
zona, painel de agendamento — cobrem lacunas legítimas do SIGC. O caminho
saudável é **incorporá-las ao produto**, onde herdam autenticação, perfil de
acesso, auditoria e ciclo de vida. É melhor para o IBGE e para o autor, que hoje
mantém uma extensão dependente de detalhes internos sujeitos a mudança.

---

## 5. Correção pendente no próprio SIGC

Registrada como achado contra o SIGC, não contra a extensão:

- **A exportação estadual do Último Movimento sofre timeout.** O `CSV TODAS`
  contorna o defeito; o defeito permanece. Pior: contornado, ele some das
  métricas e a pressão por corrigi-lo desaparece.
- **Os botões nativos de CSV/Excel quebram fora da VPN** (erro `MouseEvent` da
  proteção anti-bot F5). O `CSV-pro` existe por causa disso — restaura uma
  capacidade que o SIGC pretendia oferecer e não entrega.

---

## 6. Objeções retiradas

Registradas porque foram refutadas com fatos, e um parecer honesto mostra o que
não sobreviveu ao contraditório.

### 6.1 "A extensão cria exposição de dados sensíveis" — RETIRADA

**Objeção original:** a extensão converteria acesso pontual e auditado em
arquivos soltos (PDF, KML, CSV, HTML) com nome, telefone, endereço e coordenada
no computador do servidor.

**Refutação do autor:** *o SIGC já permite exportar dados pessoais sensíveis com
um clique.* Os botões nativos Copiar/CSV/Excel/PDF estão na mesma tabela, com os
mesmos dados.

**Aceita.** A capacidade é pré-existente e nativa. A extensão **reformata** o que
o SIGC já emite; não amplia o acesso. Exigir que ela remova morador/telefone
enquanto a exportação nativa os mantém é incoerente. A exposição é um achado
**contra o SIGC**, e é o mais grave desta revisão — mas não é atribuível à
extensão.

### 6.2 "`CSV TODAS` é carga indevida" — RETIRADA

**Objeção original:** uma requisição por agência, com intervalo de 2s,
representaria volume não dimensionado.

**Refutação do autor:** a exportação estadual **sofre timeout**; a extensão
particiona por agência justamente para contornar isso.

**Aceita.** A comparação correta não é "uma consulta limpa × N consultas", e sim:

| | Nativo (estado inteiro) | CSV TODAS |
|---|---|---|
| Resultado | **falha** após consumir o timeout | conclui |
| Trabalho no servidor | consulta completa, depois descartada | N consultas menores |
| Concorrência | 1 pesada | **1 por vez**, nunca paralela |
| Falha parcial | perde tudo | pula a agência e segue |

Uma consulta que roda até o timeout já fez quase todo o trabalho — planejamento,
varredura, ordenação, materialização — e o descarta, segurando worker e conexão
pelo tempo inteiro. E **convida a retentativa**: o usuário clica de novo,
gerando concorrência pior que a da extensão.

O padrão da extensão (serial, pausado, nunca paralelo) é **mais conservador que o
caminho nativo que substitui**. O pico melhora; o total sobe um pouco; a duração
é bem maior — e, para este sistema, pico é o que dói.

Ressalva mantida: não há coordenação global. Dez supervisores simultâneos geram
dez fluxos seriais — provavelmente ainda mais leve que dez consultas estaduais
em timeout, mas convém medir em vez de supor.

### 6.3 "Migrar para ISOLATED world" — RETIRADA

Inviável: a extensão depende de globais de página (`window.pdfMake`,
`window.jQuery`, instância do DataTables), invisíveis de um mundo isolado. A
parte que usa `chrome.storage` **já está** isolada via relay. A escolha é
motivada por requisito, não por conveniência.

### 6.4 "A documentação nega contato com terceiros" — CORRIGIDA NESTA VERSÃO

Até a v0.2.173, `PRIVACY_POLICY.html` afirmava que nenhuma informação saía do
circuito usuário–IBGE, enquanto a extensão buscava tiles do OpenStreetMap. Era o
achado com maior chance de reprovação na Chrome Web Store — não pela requisição,
mas pela contradição entre política publicada e comportamento observável.

Corrigido no commit `772248d`: a afirmação foi delimitada a *dados do SIGC*, com
a requisição de tiles divulgada em `README.md`, `LEIA-ME.txt`,
`docs/store-listing.md` e `docs/PRIVACY_POLICY.html`.

### 6.5 Sobre a aprovação na Chrome Web Store

O revisor da Google verifica políticas de plataforma. **Não avalia sigilo
estatístico, LGPD ou o contexto da PNS.** Aprovação da Google não constitui aval
institucional e não deve ser apresentada como tal.

---

## 7. Conclusão

O risco dominante **não é código malicioso** — a extensão é somente leitura, não
pede permissões amplas, não carrega código remoto e é verificada
automaticamente.

O que resta é **governança**: um canal de atualização não controlado com acesso à
sessão autenticada, perda de auditabilidade nos logs do SIGC, um *patch* em
global da página e acoplamento a detalhes internos que transferem o custo da
manutenção para a equipe do SIGC.

E o achado mais desconfortável desta revisão não é sobre a extensão: **é o
próprio SIGC que já entrega dados pessoais sensíveis em um clique, e cuja
exportação estadual não funciona.** A extensão tornou os dois fatos visíveis.
