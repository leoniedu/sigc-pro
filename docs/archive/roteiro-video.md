# Roteiro de vídeo — SIGC-PRO para gestores estaduais

**Duração alvo:** 6–7 minutos.
**Público:** gestores estaduais da coleta (supervisores de UF da PNS 2026).
**Formato:** gravação de tela do SIGC com narração. As colunas "Na tela"
descrevem o que gravar; "Narração" é o texto a ser lido.

> Antes de gravar: use dados de homologação ou borre nomes, telefones e
> endereços na edição. O vídeo não deve expor dados reais de moradores.

---

## Cena 1 — Abertura (0:00–0:30)

**Na tela:** logotipo/nome SIGC-PRO sobre uma captura do SIGC; em seguida,
uma página de relatório com os botões azuis visíveis ao lado dos nativos.

**Narração:**

> Se você coordena a coleta da PNS no seu estado, passa o dia dentro do
> SIGC — e sabe o que falta nele: exportações que funcionam fora da VPN,
> um mapa da situação de campo e uma visão de capacidade da agenda.
>
> O SIGC-PRO é uma extensão de navegador, não oficial e de código aberto,
> que adiciona botões azuis ao lado dos botões nativos do SIGC — sem
> alterar nada do sistema. E com uma regra de ouro: nenhum dado do SIGC
> sai do circuito entre você e o servidor do IBGE. A extensão não pede
> nenhuma permissão do navegador e não armazena nada.

---

## Cena 2 — CSV-pro: exportar qualquer relatório (0:30–1:10)

**Na tela:** um relatório qualquer com tabela. Clicar no botão nativo de
CSV e mostrar o erro fora da VPN; depois clicar em **CSV-pro** e abrir o
arquivo no Excel.

**Narração:**

> Começando pelo problema mais conhecido: fora da VPN, os botões nativos
> de CSV e Excel do portal falham. O CSV-pro resolve isso lendo a tabela
> diretamente, sem depender desses botões. Um clique, e o relatório
> inteiro — todas as páginas, não só a que está na tela — vira um CSV
> pronto para o Excel brasileiro. Funciona em qualquer relatório do SIGC
> que tenha tabela.

---

## Cena 3 — CSV TODAS: a visão do estado inteiro (1:10–1:50)

**Na tela:** relatório Último Movimento. Clicar em **CSV TODAS**, mostrar
a confirmação com o número de agências, deixar rodar (acelerar na edição)
e abrir o CSV final com as colunas IdUf/IdAgencia/AgenciaDescricao.

**Narração:**

> Para quem gerencia o estado, olhar uma agência por vez não basta. O
> botão CSV TODAS baixa o Último Movimento de todas as agências da UF e
> combina tudo em um único arquivo, com a agência identificada em cada
> linha. Ele faz uma requisição por agência ao próprio servidor do SIGC,
> avisa quantas serão consultadas antes de começar e, se uma falhar, pula
> e segue com as demais. Alguns minutos depois, você tem a base completa
> do estado para as suas planilhas e painéis.

---

## Cena 4 — Mapa-pro: a situação de campo no mapa (1:50–4:00)

**Na tela:** Último Movimento filtrado por município. Clicar em
**MAPA-PRO**, mostrar as duas confirmações (dados do SIGC; depois o fundo
OpenStreetMap) e percorrer as quatro abas na ordem da narração.

**Narração:**

> Agora a principal ferramenta de acompanhamento: o Mapa-pro. Ele
> funciona no Último Movimento e no Relatório de Acompanhamento de
> Biomarcadores, sobre o mesmo filtro que você já submeteu — agência,
> município ou controle.
>
> A aba **Mapa** mostra cada domicílio do recorte, colorido pela situação
> da coleta. Os marcadores crescem com o zoom, os casos perto do prazo
> ganham destaque, e cada agência é uma camada que pode ser ligada ou
> desligada. Quando vários domicílios dividem o mesmo endereço, eles se
> abrem em leque — nenhum fica escondido atrás do outro.
>
> A aba **Zonas** — ou **Controles**, no Último Movimento — mostra o
> andamento de cada grupo, inclusive os que ainda não tiveram nenhuma
> coleta: o que já foi feito, o que está agendado, o que ainda precisa de
> agendamento e quantos horários da agenda seguem livres. Os casos mais
> problemáticos aparecem no topo. É a pergunta do gestor — "onde está o
> gargalo?" — respondida em uma tabela.
>
> A aba **Domicílios** traz a lista completa, com a situação e a ação
> devida em cada caso, e um pino que leva direto ao domicílio no mapa.
> Todas as abas de dados podem ser baixadas em CSV.
>
> E a aba **Entenda** documenta de onde vem cada número do painel: o que
> o relatório afirma, o que foi calculado a partir dele e o que é apenas
> provável. Uma estimativa nunca é apresentada como fato — o que importa
> quando o número vai parar numa reunião de coordenação.
>
> Os dados vêm do próprio servidor do SIGC, na sua sessão, mediante
> clique e confirmação. O único recurso externo é o fundo do mapa, as
> imagens do OpenStreetMap — que têm confirmação própria e não carregam
> nenhum dado do SIGC. Se você recusar, as abas de tabela continuam
> funcionando normalmente.

---

## Cena 5 — Lista de Endereços: PDF-pro e KML-pro (4:00–4:40)

**Na tela:** Lista de Endereços. Clicar em **PDF-pro** e mostrar o PDF;
depois **KML-pro** e abrir o arquivo no Google Earth.

**Narração:**

> Na Lista de Endereços, dois exportadores para apoiar o campo. O PDF-pro
> reexporta a listagem no formato clássico do IBGE: colunas reorganizadas
> e as informações-chave — Controle, Situação, Zona, número de
> selecionados — promovidas ao cabeçalho.
>
> O KML-pro exporta os endereços para o Google Earth, o Google Maps ou o
> QGIS, com camadas separadas para domicílios selecionados e não
> selecionados, em cores seguras para daltonismo. Útil para planejar o
> deslocamento das equipes antes de irem a campo.

---

## Cena 6 — Agenda: capacidade e operação do dia (4:40–6:10)

**Na tela:** Administrar Agenda, visão Semana. Mostrar **CSV-PRO**,
**Verificar Slots**, o painel **Slots Abertos** e o seletor de data;
depois mudar para a visão Dia e gerar o **Guia do Dia** com mapa,
percorrendo as abas Resumo, Lab e uma equipe, marcando checkboxes de rota.

**Narração:**

> Na tela de Administrar Agenda, o SIGC-PRO vira uma central de operação.
>
> O CSV-PRO exporta os slots do calendário com tudo o que o SIGC só
> mostra dentro do texto de cada slot — Controle, domicílio, nome,
> endereço, telefone — já separado em colunas.
>
> O Verificar Slots alerta, em um clique, sobre slots abertos agendados
> dentro do prazo mínimo de agendamento e sobre zonas cujo nome não
> corresponde à equipe.
>
> Na visão Semana, o painel Slots Abertos cruza zona e turno e mostra
> quantos horários seguem livres sobre o total de cada zona — a base para
> decidir onde abrir capacidade.
>
> E o Guia do Dia gera um arquivo HTML autônomo, que abre sem internet:
> um resumo do dia com a grade de horários por equipe; uma aba Lab, feita
> para compartilhar com o laboratório — só hora, nome, município e zona,
> sem Controle nem domicílio; e um cartão por visita, para cada equipe,
> pronto para imprimir. Aceitando a consulta opcional ao servidor do
> SIGC, o guia ganha ainda o mapa da rota do dia, link de navegação por
> visita e uma rota do Google Maps que se atualiza conforme você marca as
> paradas.
>
> Há até um seletor de data para pular direto ao dia que interessa, sem
> navegar semana a semana.

---

## Cena 7 — Privacidade e encerramento (6:10–7:00)

**Na tela:** a lista `permissions` vazia em `chrome://extensions` /
manifesto; o repositório no GitHub; tela final com o link de instalação.

**Narração:**

> Sobre privacidade, o resumo é simples: nada sai do circuito entre você
> e o IBGE. A extensão não pede nenhuma permissão do navegador, não
> armazena nada, não tem telemetria, e todas as consultas de dados vão ao
> próprio servidor do SIGC, na sua sessão, sempre atrás de um clique e
> uma confirmação. Isso é verificado automaticamente a cada alteração no
> código-fonte, que é aberto.
>
> O SIGC-PRO é um projeto independente, sem vínculo oficial com o IBGE —
> um protótipo para uso das equipes e demonstração ao time de
> desenvolvimento do SIGC.
>
> O link de instalação e o código estão na descrição. Bom uso — e boa
> coleta.

---

## Checklist de gravação

- [ ] Dados de homologação ou anonimização na edição (nomes, telefones, endereços).
- [ ] Gravar fora da VPN para o erro nativo de CSV da Cena 2 aparecer.
- [ ] Filtro já submetido antes de abrir o Mapa-pro (agência, município ou controle).
- [ ] Mostrar as confirmações de consulta — elas são parte do argumento de privacidade.
- [ ] Visão Dia ativa antes de gerar o Guia do Dia.
- [ ] Versão da extensão visível ou citada na tela final.
