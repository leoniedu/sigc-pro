// SIGC-PRO feature: Carta de notificação — a one-page A4 PDF notification
// letter to the resident of a household, generated from the Domicílios
// tab of the MAPA-PRO panel (Último Movimento and Relatório de
// Acompanhamento de Biomarcadores). Every variable part of the letter is
// an editable AcroForm text field, prefilled from live SIGC data: the
// household's address (Lista de Endereços of the recorte), the agent who
// holds it (the row's Entrevistador) and that agent's cadastro (função,
// e-mail, telefone, agência — looked up on click by usuario-lookup.js).
//
// Drawn from scratch with pdf-lib (vendored under extension/vendor/
// pdf-lib/, loaded on first use through the same ISOLATED-world relay +
// `.jsUrl` pattern as Leaflet — see ultimo-movimento-map-relay.js). The
// two letterhead images come from extension/vendor/carta-assets/, a
// script that sets one global, loaded the same way. pdfMake, which the
// page already loads, cannot create form fields; that is why pdf-lib.
//
// This directory is a LOCAL-RESOURCE directory for scripts/
// check-privacy.sh: it may set a script's source from a `.jsUrl` property
// and nothing else — no requests of any kind. The usuário lookup lives in
// its own fetch-sanctioned directory for that reason.
// Spec: docs/superpowers/specs/2026-10-09-carta-notificacao-design.md
(function () {
  'use strict';

  const TAG = '[sigc-carta-notificacao]';
  const P = () => window.__sigcPro;

  // The survey the letter is about. Year and collection period are text
  // in the letter and go stale with the survey, so they are named here,
  // next to each other, rather than buried in the paragraphs below.
  const PESQUISA_ANO = '2026';
  const PERIODO_COLETA = 'julho a novembro';

  // --- text (pt-BR, verbatim from the spec; ** = bold) -----------------------

  const SAUDACAO_PADRAO = 'Prezado(a) morador(a),';

  const PARAGRAFO_1 =
    `Seu domicílio foi selecionado para a Pesquisa Nacional de Saúde (**PNS**) ${PESQUISA_ANO}, ` +
    'realizada pelo IBGE em parceria com o Ministério da Saúde. Após várias tentativas, ' +
    'ainda não conseguimos realizar a entrevista neste endereço. A coleta vai de ' +
    `${PERIODO_COLETA}, e precisamos concluir a sua entrevista **com urgência**.`;

  const PARAGRAFO_2_BIOMARCADORES =
    'A participação tem duas etapas: a entrevista e, com o seu consentimento, uma coleta ' +
    'de sangue e urina feita por profissionais de laboratório parceiro do IBGE.';

  const PARAGRAFO_2_ENTREVISTA =
    'A participação consiste em uma entrevista com o questionário da pesquisa, feita por ' +
    'um(a) Agente de Pesquisa do IBGE.';

  // Plain hyphen in "Decreto-Lei": the word wrapper below splits on
  // spaces only, so the token never breaks at the hyphen — and U+2011
  // (non-breaking hyphen) is not WinAnsi, which the standard fonts
  // require.
  const PARAGRAFO_3 =
    'A legislação federal determina a **obrigatoriedade de prestar as informações** ' +
    'solicitadas pelo IBGE e assegura o **sigilo**: os dados são usados exclusivamente ' +
    'para fins estatísticos, nenhum dado que permita identificar o informante é divulgado ' +
    'ou compartilhado com outros órgãos, e as informações não podem servir de prova em ' +
    'processo administrativo, fiscal ou judicial (Decreto-Lei nº 161/1967; Lei nº ' +
    '5.534/1968; Lei nº 5.878/1973).';

  const PARAGRAFO_4 =
    'Podemos voltar **à noite ou no fim de semana**, ou no horário que for melhor para você. ' +
    'Entre em contato com o(a) agente abaixo o quanto antes para **agendar a entrevista**. ' +
    'A identidade dos nossos profissionais pode ser conferida em **respondendo.ibge.gov.br** ' +
    'ou pelo **0800 721 8181**.';

  const PARAGRAFO_5 = '**Você é fundamental para o conhecimento do País.**';

  const TITULO = `NOTIFICAÇÃO — PESQUISA NACIONAL DE SAÚDE ${PESQUISA_ANO}`;
  const SERVICO_PUBLICO = 'SERVIÇO PÚBLICO FEDERAL';
  const URGENTE = 'URGENTE';
  const SUPERINTENDENCIA = 'Superintendência Estadual do IBGE';
  const RODAPE_DIREITA = 'www.ibge.gov.br · 0800 721 8181';
  const ATENCIOSAMENTE = 'Atenciosamente,';
  const ROTULOS_DESTINATARIO = ['Endereço:', 'Complemento:', 'Bairro:', 'Município:', 'Controle:', 'Domicílio:'];
  // "Função", as the cadastro form itself calls it (the field keeps the
  // pns.zonas name cargo_descricao).
  const ROTULOS_AGENTE = ['Nome:', 'Matrícula:', 'Função:', 'Telefone:', 'E-mail:', 'Agência:'];

  // Every static string the letter draws, in one place, so a test can
  // assert each one encodes in WinAnsi (the standard fonts throw on
  // anything outside it — a stray U+2011 or emoji would kill the whole
  // letter at click time).
  const TEXTOS = [
    SAUDACAO_PADRAO, PARAGRAFO_1, PARAGRAFO_2_BIOMARCADORES, PARAGRAFO_2_ENTREVISTA,
    PARAGRAFO_3, PARAGRAFO_4, PARAGRAFO_5, TITULO, SERVICO_PUBLICO, URGENTE,
    SUPERINTENDENCIA, RODAPE_DIREITA, ATENCIOSAMENTE,
    ...ROTULOS_DESTINATARIO, ...ROTULOS_AGENTE,
  ];

  // The field names, exactly — the first 13 are the pns.zonas letter's
  // AcroForm names, so a filled PDF from either source reads the same;
  // `assinante` (blank) and `superintendencia` are the two editable
  // closing lines under the signature space.
  const CAMPOS = [
    'saudacao', 'endereco', 'complemento', 'bairro', 'municipio', 'controle', 'domicilio',
    'nome', 'siape', 'cargo_descricao', 'celular_pessoal', 'email_institucional',
    'agencia_descricao', 'assinante', 'superintendencia',
  ];

  // --- superintendência by UF -------------------------------------------------

  // IBGE 2-digit UF code -> "<preposição> <nome>", the phrase after
  // "Superintendência Estadual do IBGE". Unknown code -> '' (the phrase
  // is then used alone).
  const PREP_UF = {
    11: 'em Rondônia', 12: 'no Acre', 13: 'no Amazonas', 14: 'em Roraima',
    15: 'no Pará', 16: 'no Amapá', 17: 'no Tocantins', 21: 'no Maranhão',
    22: 'no Piauí', 23: 'no Ceará', 24: 'no Rio Grande do Norte', 25: 'na Paraíba',
    26: 'em Pernambuco', 27: 'em Alagoas', 28: 'em Sergipe', 29: 'na Bahia',
    31: 'em Minas Gerais', 32: 'no Espírito Santo', 33: 'no Rio de Janeiro', 35: 'em São Paulo',
    41: 'no Paraná', 42: 'em Santa Catarina', 43: 'no Rio Grande do Sul', 50: 'em Mato Grosso do Sul',
    51: 'em Mato Grosso', 52: 'em Goiás', 53: 'no Distrito Federal',
  };

  function prepUf(uf) {
    return PREP_UF[String(uf ?? '').replace(/\D/g, '').slice(0, 2)] || '';
  }

  function superintendencia(uf) {
    const p = prepUf(uf);
    return p ? `${SUPERINTENDENCIA} ${p}` : SUPERINTENDENCIA;
  }

  // --- title case (port of orce::ToTitleCasePT) --------------------------------

  // Lower-cased when not the first word: articles, prepositions (and
  // their contractions), oblique pronouns and conjunctions — the same
  // list the R function keeps.
  const PARTICULAS = new Set([
    'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
    'ao', 'aos', 'à', 'às', 'ante', 'até', 'após', 'com', 'contra', 'de', 'desde',
    'do', 'da', 'dos', 'das', 'e', 'em', 'entre', 'na', 'no', 'nas', 'nos',
    'para', 'pela', 'pelo', 'pelas', 'pelos', 'perante', 'por', 'sem', 'sob', 'sobre', 'trás',
    'lhe', 'lhes', 'me', 'meu', 'meus', 'mim', 'minha', 'minhas',
    'nosso', 'nossa', 'nossos', 'nossas', 'se', 'seu', 'seus', 'sua', 'suas',
    'te', 'teu', 'teus', 'ti', 'tua', 'tuas', 'vosso', 'vossa', 'vossos', 'vossas',
    'conforme', 'conquanto', 'contudo', 'embora', 'enquanto', 'então', 'entretanto',
    'exceto', 'logo', 'mas', 'nem', 'ou', 'ora', 'pois', 'porém', 'porque', 'porquanto',
    'portanto', 'quando', 'quanto', 'que', 'senão', 'todavia',
  ]);

  // A well-formed Roman numeral in i/v/x only ("i", "ii", "iv", "xiii"):
  // the ones that number quadras, lotes and conjuntos. Letters l/c/d/m
  // are left out on purpose — "di", "mil", "cd" are words, not numerals.
  const ROMANO = /^(?=[ivx])x{0,3}(ix|iv|v?i{0,3})$/;

  function capitalizar(part) {
    if (ROMANO.test(part)) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  }

  // "RUA SILVEIRA MARTINS 3200" -> "Rua Silveira Martins 3200";
  // "ALEXANDRE SILVA DE SANTANA" -> "Alexandre Silva de Santana";
  // "URBIS I" -> "Urbis I"; "S/N" -> "S/N".
  function titleCasePt(s) {
    const words = String(s ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.map((w, i) => {
      // Never the first word, and never the last: a trailing "A" or "E"
      // is a name's letter ("Rua A", "Bloco E"), not a preposition.
      if (i > 0 && i < words.length - 1 && PARTICULAS.has(w)) return w;
      // Sub-tokens around "/", "-", "(" and "'" each get their own
      // capital ("S/N", "Beco-Rua", "(Fundos)", "D'Ávila"), the
      // separator kept as is.
      return w.split(/([/\-('])/).map((part, j) => (j % 2 === 1 ? part : capitalizar(part))).join('');
    }).join(' ');
  }

  // --- phone ----------------------------------------------------------------

  // +557190000000 -> (71) 9000-0000; +5571990000000 -> (71) 99000-0000;
  // anything else verbatim.
  function formatTelefone(s) {
    const raw = String(s ?? '').trim();
    const d = raw.replace(/\D/g, '');
    if (/^55\d{10}$/.test(d)) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
    if (/^55\d{11}$/.test(d)) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    return raw;
  }

  // --- row -> letter data --------------------------------------------------------

  // The row's Entrevistador reads "<siape> - NOME" (the same value the
  // Entrevistadores tab groups by). Anything else is taken as a bare
  // name with no SIAPE — the cadastro lookup is then skipped.
  function agenteDaLinha(entrevistador) {
    const s = String(entrevistador ?? '').trim();
    const m = /^(\d+)\s*-\s*(.+)$/.exec(s);
    if (m) return { siape: m[1], nome: m[2].trim() };
    return { siape: '', nome: s };
  }

  // Número 0/empty -> S/N; a complemento starting with "SN " repeats the
  // missing number and drops that token.
  function enderecoDaLinha(row) {
    const log = titleCasePt(row && row.logradouro);
    const numRaw = String((row && row.numero) ?? '').trim();
    const numero = (!numRaw || /^0+$/.test(numRaw) || /^s\s*\/?\s*n\.?$/i.test(numRaw)) ? 'S/N' : numRaw;
    let comp = String((row && row.complemento) ?? '').trim();
    if (/^SN(\s|$)/i.test(comp)) comp = comp.replace(/^SN\s*/i, '');
    return {
      endereco: log ? `${log}, ${numero}` : '',
      complemento: titleCasePt(comp),
      bairro: titleCasePt(row && row.bairro),
      temEndereco: Boolean(log),
    };
  }

  // 'SALVADOR - BA' (municipios.js) -> 'Salvador/BA'.
  function municipioDaLinha(controle) {
    const fn = P() && P().municipioFromControle;
    const raw = fn ? fn(controle) : '';
    const m = /^(.*?)\s*-\s*([A-Z]{2})$/.exec(String(raw || '').trim());
    if (!m) return titleCasePt(raw);
    return `${titleCasePt(m[1])}/${m[2]}`;
  }

  function ufDaLinha(controle, filtro) {
    const d = String(controle ?? '').replace(/\D/g, '');
    if (d.length >= 2) return d.slice(0, 2);
    return String((filtro && filtro.IdUf) || '').replace(/\D/g, '').slice(0, 2);
  }

  const WILDCARDS = new Set(['', '0', '-1', '*', 'todos', 'todas', 'null', 'undefined']);
  function isWildcard(v) {
    return WILDCARDS.has(String(v ?? '').trim().toLowerCase());
  }

  // The filter stores the agência's id, not its name. The name comes
  // from the page's own agência select when the profile has one, else
  // from the UF's agência list (/Filtro/CarregarAgencias, the request
  // CSV TODAS makes first — fetched by ultimo-movimento-export, the
  // directory sanctioned for it), cached per UF for the page's life.
  // A filter without an agência (município, controle) yields '' — the
  // letter's Agência is then left for the issuer to fill.
  function agenciaDoFiltroSelect(filtro, doc) {
    const id = filtro && filtro.IdAgencia;
    if (isWildcard(id)) return '';
    const sel = (doc || document).getElementById('IdAgencia');
    if (!sel) return '';
    const opt = [...sel.querySelectorAll('option')].find((o) => String(o.value) === String(id));
    return opt ? opt.textContent.trim() : '';
  }

  const agenciasPorUf = new Map();
  async function agenciaDoFiltro(filtro, doc) {
    const id = filtro && filtro.IdAgencia;
    if (isWildcard(id)) return '';
    const doSelect = agenciaDoFiltroSelect(filtro, doc);
    if (doSelect) return doSelect;
    const uf = String((filtro && filtro.IdUf) || '').trim();
    const E = window.__sigcProUltimoMovimentoExportInternals;
    if (!uf || !E || !E.fetchAgenciaList) return '';
    try {
      if (!agenciasPorUf.has(uf)) agenciasPorUf.set(uf, E.fetchAgenciaList(uf));
      const lista = await agenciasPorUf.get(uf);
      const hit = (lista || []).find((a) => String(a.key) === String(id));
      return hit ? String(hit.description || '').trim() : '';
    } catch (err) {
      agenciasPorUf.delete(uf);
      console.warn(`${TAG} lista de agências não lida:`, err);
      return '';
    }
  }

  function biomarcadoresSim(v) {
    return String(v ?? '').trim().toLowerCase() === 'sim';
  }

  // Everything the PDF builder needs, from the joined row plus whatever
  // the cadastro lookup returned (null when it failed or was skipped).
  function dadosDaCarta({ row, modo, filtro, cadastro, agenciaFiltro }) {
    const r = row || {};
    const end = enderecoDaLinha(r);
    const agente = agenteDaLinha(r.entrevistador);
    const cad = cadastro || {};
    const nome = titleCasePt(cad.nome || agente.nome);
    // Both reports can carry an Agência per row (always on the
    // biomarcadores page; on Último Movimento when the live table has
    // the column). The row wins, then the filter's agência — the
    // household's, which is what the letter is about — and only then
    // the agent's own posto from the cadastro.
    const agenciaLinha = String(r.agencia || '').trim();
    const uf = ufDaLinha(r.controle, filtro);
    return {
      uf,
      biomarcadores: biomarcadoresSim(r.biomarcadores),
      temEndereco: end.temEndereco,
      nomeAgente: nome,
      campos: {
        saudacao: SAUDACAO_PADRAO,
        endereco: end.endereco,
        complemento: end.complemento,
        bairro: end.bairro,
        municipio: municipioDaLinha(r.controle),
        controle: String(r.controle ?? '').trim(),
        domicilio: String(r.domicilio ?? '').trim(),
        nome,
        // The row's siape is what the lookup was keyed on; it is the
        // verified one.
        siape: agente.siape || cad.siape || '',
        cargo_descricao: String(cad.funcao || '').trim(),
        celular_pessoal: formatTelefone(cad.celular || cad.telefone || ''),
        email_institucional: String(cad.email || '').trim(),
        agencia_descricao: agenciaLinha || String(agenciaFiltro || '').trim() ||
          String(cad.agencia || '').trim(),
        assinante: '',
        superintendencia: superintendencia(uf),
      },
    };
  }

  function nomeArquivo(campos) {
    const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '') || 'x';
    return `carta_${safe(campos.controle)}_${safe(campos.domicilio)}.pdf`;
  }

  // --- PDF ------------------------------------------------------------------------

  const CM = 72 / 2.54;
  const PAGE = { w: 595.28, h: 841.89 };            // A4
  const MARGEM = { lado: 2.2 * CM, topo: 1.6 * CM, base: 1.8 * CM };
  const LARGURA = PAGE.w - 2 * MARGEM.lado;

  const COR = {
    azul: [0, 0x42 / 255, 0x82 / 255],
    azulClaro: [0xf2 / 255, 0xf6 / 255, 0xfb / 255],
    vermelho: [0xc8 / 255, 0x10 / 255, 0x2e / 255],
    cinza: [0x55 / 255, 0x55 / 255, 0x55 / 255],
    preto: [0, 0, 0],
  };

  const CAMPO = { tamanho: 10, altura: 13 };

  // '**bold**' markup -> words, each a list of runs {text, bold}. A word
  // is anything between spaces, so "(PNS)" with only "PNS" bold is one
  // word of three runs and never splits across lines.
  function palavras(rich) {
    const out = [];
    let bold = false;
    let atual = null;
    String(rich).split('**').forEach((seg, i) => {
      if (i > 0) bold = !bold;
      seg.split(/(\s+)/).forEach((piece) => {
        if (!piece) return;
        if (/^\s+$/.test(piece)) { if (atual) { out.push(atual); atual = null; } return; }
        if (!atual) atual = [];
        atual.push({ text: piece, bold });
      });
    });
    if (atual) out.push(atual);
    return out;
  }

  // Justified rich paragraph. Returns the y of the next baseline-to-be
  // (i.e. the cursor after the paragraph, before paragraph spacing).
  function drawParagrafo(page, fonts, rich, { x, y, width, size, lineHeight, color, justify }) {
    const { helv, bold } = fonts;
    const fontOf = (run) => (run.bold ? bold : helv);
    const larguraPalavra = (w) => w.reduce((s, run) => s + fontOf(run).widthOfTextAtSize(run.text, size), 0);
    const espaco = helv.widthOfTextAtSize(' ', size);
    const words = palavras(rich).map((w) => ({ runs: w, width: larguraPalavra(w) }));
    const linhas = [];
    let linha = [];
    let usado = 0;
    words.forEach((w) => {
      const precisa = linha.length ? usado + espaco + w.width : w.width;
      if (linha.length && precisa > width) {
        linhas.push({ words: linha, width: usado });
        linha = [w];
        usado = w.width;
      } else {
        linha.push(w);
        usado = precisa;
      }
    });
    if (linha.length) linhas.push({ words: linha, width: usado });
    const rgb = (c) => fonts.rgb(c[0], c[1], c[2]);
    let cy = y - size;
    linhas.forEach((l, li) => {
      const ultima = li === linhas.length - 1;
      const gaps = l.words.length - 1;
      const extra = (justify && !ultima && gaps > 0) ? (width - l.width) / gaps : 0;
      let cx = x;
      l.words.forEach((w, wi) => {
        w.runs.forEach((run) => {
          page.drawText(run.text, { x: cx, y: cy, size, font: fontOf(run), color: rgb(color) });
          cx += fontOf(run).widthOfTextAtSize(run.text, size);
        });
        if (wi < gaps) cx += espaco + extra;
      });
      cy -= lineHeight;
    });
    return cy + lineHeight - size;
  }

  // The standard fonts are WinAnsi-only and throw on anything else; a
  // cadastro or complemento is free text. Characters the font cannot
  // encode become "?" rather than failing the whole letter.
  function winAnsiSafe(font, text) {
    const s = String(text ?? '');
    try { font.encodeText(s); return s; } catch (err) { /* fall through */ }
    return [...s].map((ch) => {
      try { font.encodeText(ch); return ch; } catch (err) { return '?'; }
    }).join('');
  }

  // A text field with the house look: 10 pt Helvetica, dark blue, no
  // border. Shrinks the font (never below 7 pt) when the value would
  // overflow the box, so a 60-character address stays readable instead
  // of being clipped.
  function campoTexto(form, page, fonts, name, value, { x, y, width, height, bold, size, color, bg }) {
    const { PDFLib } = fonts;
    const font = bold ? fonts.bold : fonts.helv;
    const field = form.createTextField(name);
    const tam = size || CAMPO.tamanho;
    const texto = winAnsiSafe(font, value);
    let fontSize = tam;
    if (texto) {
      const w = font.widthOfTextAtSize(texto, tam);
      if (w > width - 4) fontSize = Math.max(7, Math.floor((tam * (width - 4)) / w * 10) / 10);
    }
    const cor = color || COR.azul;
    field.addToPage(page, {
      x, y, width, height,
      textColor: PDFLib.rgb(cor[0], cor[1], cor[2]),
      backgroundColor: PDFLib.rgb(...(bg || [1, 1, 1])),
      borderWidth: 0,
      font,
    });
    field.setFontSize(fontSize);
    if (texto) field.setText(texto);
    field.updateAppearances(font);
    return field;
  }

  // dados: from dadosDaCarta. deps: { PDFLib, assets } — the vendored
  // library's global and the letterhead images. Returns the PDF bytes.
  async function buildCartaPdf(dados, deps) {
    const { PDFLib, assets } = deps;
    const { PDFDocument, StandardFonts, rgb, PDFName } = PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(`Carta de notificação — ${dados.campos.controle}/${dados.campos.domicilio}`);
    doc.setLanguage('pt-BR');
    const page = doc.addPage([PAGE.w, PAGE.h]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fonts = { helv, bold, rgb, PDFLib };
    const form = doc.getForm();
    // Default resources for the form, so a viewer regenerating a field's
    // appearance after an edit finds the fonts the DA strings name.
    form.acroForm.dict.set(PDFName.of('DR'), doc.context.obj({
      Font: { [helv.name]: helv.ref, [bold.name]: bold.ref },
    }));
    const cor = (c) => rgb(c[0], c[1], c[2]);
    const direita = PAGE.w - MARGEM.lado;
    const x0 = MARGEM.lado;
    let y = PAGE.h - MARGEM.topo;

    // 1. Letterhead: logo left, superintendência right, both bottom-aligned.
    const logo = await doc.embedPng(assets.logoPng);
    const logoW = 6.2 * CM;
    const logoH = logoW * (logo.height / logo.width);
    page.drawImage(logo, { x: x0, y: y - logoH, width: logoW, height: logoH });
    const sup = superintendencia(dados.uf).toUpperCase();
    page.drawText(sup, {
      x: direita - bold.widthOfTextAtSize(sup, 9), y: y - logoH + 2, size: 9, font: bold, color: cor(COR.azul),
    });
    y -= logoH + 4;
    page.drawLine({ start: { x: x0, y }, end: { x: direita, y }, thickness: 1.2, color: cor(COR.azul) });
    y -= 8;

    // 2. Brasão + SERVIÇO PÚBLICO FEDERAL (one line) left, URGENTE box right.
    const brasao = await doc.embedPng(assets.brasaoPng);
    const brasaoH = 1.9 * CM;
    const brasaoW = brasaoH * (brasao.width / brasao.height);
    page.drawImage(brasao, { x: x0, y: y - brasaoH, width: brasaoW, height: brasaoH });
    const yc = y - brasaoH / 2;
    page.drawText(SERVICO_PUBLICO, { x: x0 + brasaoW + 10, y: yc - 3, size: 9, font: bold, color: cor(COR.preto) });
    const urgW = bold.widthOfTextAtSize(URGENTE, 20) + 20;
    const urgH = 30;
    page.drawRectangle({
      x: direita - urgW, y: yc - urgH / 2, width: urgW, height: urgH,
      borderColor: cor(COR.vermelho), borderWidth: 2,
    });
    page.drawText(URGENTE, { x: direita - urgW + 10, y: yc - 7, size: 20, font: bold, color: cor(COR.vermelho) });
    y -= brasaoH + 10;

    // 3. Title.
    y -= 13;
    page.drawText(TITULO, {
      x: x0 + (LARGURA - bold.widthOfTextAtSize(TITULO, 13)) / 2, y, size: 13, font: bold, color: cor(COR.azul),
    });
    y -= 10;

    // 4. Destinatário block: left rule, grey labels, two columns.
    const linhaAlt = 15;
    const blocoH = 4 * linhaAlt + 8;
    page.drawLine({ start: { x: x0 + 1, y }, end: { x: x0 + 1, y: y - blocoH }, thickness: 2, color: cor(COR.azul) });
    const labelSize = 9.5;
    const lx = x0 + 12;
    const labelW = Math.max(...ROTULOS_DESTINATARIO.slice(0, 4).map((l) => helv.widthOfTextAtSize(l, labelSize)));
    const campoDirW = 2.8 * CM;
    const campoDirX = direita - campoDirW;
    const labelDirW = Math.max(...ROTULOS_DESTINATARIO.slice(4).map((l) => helv.widthOfTextAtSize(l, labelSize)));
    const labelDirX = campoDirX - 6 - labelDirW;
    const campoEsqX = lx + labelW + 6;
    const campoEsqW = labelDirX - 12 - campoEsqX;
    const esquerda = [['endereco', 0], ['complemento', 1], ['bairro', 2], ['municipio', 3]];
    esquerda.forEach(([name, i]) => {
      const base = y - 4 - 11 - i * linhaAlt;
      page.drawText(ROTULOS_DESTINATARIO[i], { x: lx, y: base, size: labelSize, font: helv, color: cor(COR.cinza) });
      campoTexto(form, page, fonts, name, dados.campos[name],
        { x: campoEsqX, y: base - 3, width: campoEsqW, height: CAMPO.altura });
    });
    [['controle', 0], ['domicilio', 1]].forEach(([name, i]) => {
      const base = y - 4 - 11 - i * linhaAlt;
      page.drawText(ROTULOS_DESTINATARIO[4 + i], { x: labelDirX, y: base, size: labelSize, font: helv, color: cor(COR.cinza) });
      campoTexto(form, page, fonts, name, dados.campos[name],
        { x: campoDirX, y: base - 3, width: campoDirW, height: CAMPO.altura });
    });
    y -= blocoH + 8;

    // 5. Greeting: an editable field, bold 11 pt black.
    campoTexto(form, page, fonts, 'saudacao', dados.campos.saudacao,
      { x: x0, y: y - 15, width: LARGURA, height: 15, bold: true, size: 11, color: COR.preto });
    y -= 15 + 6;

    // 6. Body.
    const corpo = [
      PARAGRAFO_1,
      dados.biomarcadores ? PARAGRAFO_2_BIOMARCADORES : PARAGRAFO_2_ENTREVISTA,
      PARAGRAFO_3,
      PARAGRAFO_4,
      PARAGRAFO_5,
    ];
    corpo.forEach((p) => {
      y = drawParagrafo(page, fonts, p, {
        x: x0, y, width: LARGURA, size: 11, lineHeight: 13.6, color: COR.preto, justify: true,
      });
      y -= 5;
    });
    y -= 3;

    // 7. Agent box: centred, 78% wide, light blue fill, 1 pt blue border.
    const caixaW = LARGURA * 0.78;
    const caixaX = x0 + (LARGURA - caixaW) / 2;
    const caixaLinha = 15;
    const caixaH = ROTULOS_AGENTE.length * caixaLinha + 16;
    page.drawRectangle({
      x: caixaX, y: y - caixaH, width: caixaW, height: caixaH,
      color: cor(COR.azulClaro), borderColor: cor(COR.azul), borderWidth: 1,
    });
    const agLabelW = Math.max(...ROTULOS_AGENTE.map((l) => helv.widthOfTextAtSize(l, 10)));
    const agCampoX = caixaX + 14 + agLabelW + 8;
    const agCampoW = caixaX + caixaW - 14 - agCampoX;
    const agentes = ['nome', 'siape', 'cargo_descricao', 'celular_pessoal', 'email_institucional', 'agencia_descricao'];
    agentes.forEach((name, i) => {
      const base = y - 8 - 11 - i * caixaLinha;
      page.drawText(ROTULOS_AGENTE[i], { x: caixaX + 14, y: base, size: 10, font: helv, color: cor(COR.cinza) });
      campoTexto(form, page, fonts, name, dados.campos[name],
        { x: agCampoX, y: base - 3, width: agCampoW, height: CAMPO.altura, bg: COR.azulClaro });
    });
    y -= caixaH + 8;

    // 8. Closing. No signature and no person's name by default: three
    // blank lines for whoever issues it to sign or stamp on paper, then
    // two editable lines — an empty one for the signer's name, and the
    // Superintendência line, so a unit other than the Superintendência
    // (an agência, say) can put its own name there.
    y -= 11;
    page.drawText(ATENCIOSAMENTE, { x: x0, y, size: 11, font: helv, color: cor(COR.preto) });
    y -= 3 * 12 + 12;
    campoTexto(form, page, fonts, 'assinante', dados.campos.assinante,
      { x: x0, y: y - 4, width: LARGURA, height: 15, bold: true, size: 11, color: COR.preto });
    y -= 16;
    campoTexto(form, page, fonts, 'superintendencia', dados.campos.superintendencia,
      { x: x0, y: y - 4, width: LARGURA, height: 15, bold: true, size: 11, color: COR.preto });
    y -= 15;

    // The static layout is fixed; the field values never move it. Still
    // asserted, so a future edit to the text cannot silently spill onto
    // a second page that pdf-lib would never create (it would overdraw
    // the footer instead).
    const rodapeTopo = MARGEM.base + 2;
    if (y < rodapeTopo) throw new Error(`${TAG} a carta não cabe em uma página (${Math.round(rodapeTopo - y)} pt a mais)`);

    // 9. Footer.
    page.drawLine({
      start: { x: x0, y: MARGEM.base - 4 }, end: { x: direita, y: MARGEM.base - 4 },
      thickness: 0.4, color: cor(COR.azul),
    });
    page.drawText(superintendencia(dados.uf), { x: x0, y: MARGEM.base - 14, size: 8, font: helv, color: cor(COR.cinza) });
    page.drawText(RODAPE_DIREITA, {
      x: direita - helv.widthOfTextAtSize(RODAPE_DIREITA, 8), y: MARGEM.base - 14, size: 8, font: helv, color: cor(COR.cinza),
    });

    return doc.save({ updateFieldAppearances: false });
  }

  // --- vendored library loading (relay + .jsUrl, see ultimo-movimento-map) ---

  // The ISOLATED-world relay writes the two extension URLs as data-
  // attributes on <html>; this MAIN-world file reads them on first use.
  // Two objects, one `.jsUrl` each: the privacy gate recognises a script
  // source assigned from `<expr>.jsUrl` and nothing else as a local-resource load.
  function readCartaUrls() {
    const { sigcProPdfLibJsUrl, sigcProCartaAssetsJsUrl } = document.documentElement.dataset;
    if (!sigcProPdfLibJsUrl || !sigcProCartaAssetsJsUrl) return null;
    return { pdfLib: { jsUrl: sigcProPdfLibJsUrl }, assets: { jsUrl: sigcProCartaAssetsJsUrl } };
  }

  function waitForCartaUrls() {
    return new Promise((resolve, reject) => {
      const found = readCartaUrls();
      if (found) { resolve(found); return; }
      let attempts = 0;
      const timer = setInterval(() => {
        const urls = readCartaUrls();
        attempts += 1;
        if (urls) { clearInterval(timer); resolve(urls); return; }
        if (attempts >= 20) {
          clearInterval(timer);
          reject(new Error('URLs do pdf-lib não chegaram do relay a tempo.'));
        }
      }, 100);
    });
  }

  function injetarScript(urls, rotulo) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = urls.jsUrl;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Falha ao carregar ${rotulo}.`));
      document.head.appendChild(script);
    });
  }

  // Idempotent, lazy: nothing loads until the first click, and a failure
  // clears the promise so the next click retries.
  let depsPromise = null;
  function loadCartaDeps() {
    if (depsPromise) return depsPromise;
    depsPromise = (async () => {
      if (!window.PDFLib || !window.__sigcProCartaAssets) {
        const urls = await waitForCartaUrls();
        if (!window.PDFLib) await injetarScript(urls.pdfLib, 'pdf-lib');
        if (!window.__sigcProCartaAssets) await injetarScript(urls.assets, 'as imagens da carta');
      }
      return { PDFLib: window.PDFLib, assets: window.__sigcProCartaAssets };
    })().catch((err) => { depsPromise = null; throw err; });
    return depsPromise;
  }

  // --- UI ----------------------------------------------------------------------

  const TOAST_ID = 'sigc-pro-carta-toast';
  // link: { href, label } — a same-origin page for the user to open (the
  // usuário module's login); a link, not a request. Stays longer, since
  // it asks for an action.
  function toast(msg, link) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
        'background:#333;color:#fff;padding:8px 14px;border-radius:4px;font:13px sans-serif;' +
        'z-index:1000000;max-width:80vw;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    if (link && link.href) {
      el.appendChild(document.createTextNode(' '));
      const a = document.createElement('a');
      // setAttribute, not a property assignment: the privacy gate reads
      // an href assignment in this directory as a resource load. This is
      // a link the user may click, to a same-origin page; nothing is
      // requested by this file.
      a.setAttribute('href', link.href);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = link.label || link.href;
      a.style.cssText = 'color:#9cf;text-decoration:underline';
      el.appendChild(a);
    }
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.remove(), link ? 15000 : 6000);
  }

  function status(panelEl, msg) {
    const el = panelEl && panelEl.querySelector('.sigc-pro-carta-status');
    if (el) el.textContent = msg;
  }

  // The usuário module's session is started by a real navigation, not
  // by this code: on the "no session" answer the module's index is
  // opened in a tab (inside the user's click, so no popup block), the
  // browser runs the gateway's sign-in redirects as it would for any
  // tab, and the lookup is retried every ESPERA.intervaloMs until it
  // answers or ESPERA.maxMs pass. When the single-sign-on session is
  // alive the tab closes by itself; when it is not, it shows the login
  // page and the letter follows once the user has signed in. Nothing is
  // posted to the authentication service by the extension.
  //
  // The popup blocker only lets a tab open DURING the click, and the
  // Grid request that reveals the missing session comes after it — so
  // a tab opened here is often blocked. Hence precisaSessao(): once a
  // click has learnt the session is missing, the map's click handler
  // opens the tab synchronously (abrirModuloUsuarios) BEFORE calling
  // gerarCarta and hands it in as `janela`. Cleared when a lookup
  // succeeds; a stale flag costs one tab that closes at once.
  const ESPERA = { intervaloMs: 2000, maxMs: 90000 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const JANELA_NOME = 'sigc-pro-usuario-login';
  let sessaoNecessaria = false;

  function precisaSessao() { return sessaoNecessaria; }

  // Synchronous, for the click handler: the module's index in a tab.
  function abrirModuloUsuarios() {
    const L = window.__sigcProUsuarioLookup;
    const url = L && L.loginUrl ? L.loginUrl() : '';
    if (!url) return null;
    try { return window.open(url, JANELA_NOME); } catch (err) { return null; }
  }

  function fecharJanela(win) {
    try { if (win && !win.closed) win.close(); } catch (err) { /* navigated cross-origin: leave it */ }
  }

  async function autenticarEmAba(loginUrl, siape, L, panelEl, janela) {
    const win = janela || window.open(loginUrl, JANELA_NOME);
    if (!win) return { cadastro: null, resultado: 'bloqueado' };
    status(panelEl, 'Iniciando a sessão do módulo de usuários do SIGC…');
    const inicio = Date.now();
    let ultimoErro = null;
    while (Date.now() - inicio < ESPERA.maxMs) {
      await sleep(ESPERA.intervaloMs);
      try {
        const cadastro = await L.lookupUsuario(siape);
        fecharJanela(win);
        return { cadastro, resultado: 'ok' };
      } catch (err) {
        // Any error while the tab is open is "not yet": the gateway
        // answers oddly mid-handshake (401, 403). Only the user closing
        // the tab, or the clock, ends the wait.
        ultimoErro = err;
        if (win.closed) break;
      }
    }
    return { cadastro: null, resultado: win.closed ? 'fechada' : 'tempo', erro: ultimoErro };
  }

  // One click, one file. Looks the agent up (cached, one SIAPE), builds
  // and downloads. A failed lookup still produces the letter, with the
  // agent's name and SIAPE from the row and the other fields blank.
  async function gerarCarta({ row, modo, filtro, panelEl, janela }) {
    const r = row || {};
    const rotulo = `${r.controle || '?'}/${r.domicilio || '?'}`;
    status(panelEl, `Gerando carta ${rotulo}…`);
    try {
      const agente = agenteDaLinha(r.entrevistador);
      let cadastro = null;
      let falhaCadastro = false;
      let semSessao = null;
      let bloqueado = false;
      const L = window.__sigcProUsuarioLookup;
      if (agente.siape && L) {
        try {
          cadastro = await L.lookupUsuario(agente.siape);
          sessaoNecessaria = false;
          fecharJanela(janela);
        } catch (err) {
          if (err && err.code === 'auth') {
            const r = await autenticarEmAba(err.loginUrl || '', agente.siape, L, panelEl, janela);
            cadastro = r.cadastro;
            if (r.resultado === 'ok') {
              sessaoNecessaria = false;
            } else {
              console.warn(`${TAG} sessão do módulo de usuários não iniciada (${r.resultado}):`, r.erro || '');
              falhaCadastro = true;
              semSessao = err.loginUrl || '';
              sessaoNecessaria = true;
              bloqueado = r.resultado === 'bloqueado';
            }
          } else {
            console.warn(`${TAG} cadastro não lido:`, err);
            falhaCadastro = true;
          }
        }
      } else {
        fecharJanela(janela);
      }
      const deps = await loadCartaDeps();
      // The filter's agência is only needed when the row has none —
      // and it may cost a request.
      const agenciaFiltro = String(r.agencia || '').trim() ? '' : await agenciaDoFiltro(filtro);
      const dados = dadosDaCarta({ row: r, modo, filtro, cadastro, agenciaFiltro });
      const bytes = await buildCartaPdf(dados, deps);
      P().downloadFile(nomeArquivo(dados.campos), bytes, 'application/pdf', { bom: false });
      status(panelEl, dados.nomeAgente
        ? `Carta ${rotulo} gerada para ${dados.nomeAgente}`
        : `Carta ${rotulo} gerada sem agente`);
      if (semSessao !== null) {
        toast(bloqueado
          ? 'Carta gerada sem telefone, e-mail e função do agente: é preciso iniciar a sessão do ' +
            'módulo de usuários do SIGC. Clique em Carta de novo — a extensão abre o módulo em ' +
            'uma aba e conclui a carta assim que ele responder.'
          : 'Carta gerada sem telefone, e-mail e função do agente: é preciso entrar no ' +
            'módulo de usuários do SIGC. Entre na aba aberta e clique em Carta de novo.',
        { href: semSessao, label: 'Abrir o módulo de usuários' });
      } else if (falhaCadastro) {
        toast('O cadastro do agente não pôde ser lido; a carta saiu só com nome e matrícula.');
      } else if (agente.siape && L && cadastro === null) {
        toast(`Matrícula ${agente.siape} não encontrada no módulo de usuários (ou inativa): ` +
          'função, telefone e e-mail em branco.');
      }
      if (!dados.temEndereco) toast(`Domicílio ${rotulo} sem endereço na Lista de Endereços: campos de endereço em branco.`);
      return dados;
    } catch (err) {
      console.error(`${TAG}`, err);
      status(panelEl, `Falha ao gerar a carta ${rotulo}`);
      toast(`Não foi possível gerar a carta: ${err && err.message ? err.message : err}`);
      throw err;
    }
  }

  window.__sigcProCarta = {
    gerarCarta,
    buildCartaPdf,
    dadosDaCarta,
    agenteDaLinha,
    enderecoDaLinha,
    municipioDaLinha,
    agenciaDoFiltro,
    agenciaDoFiltroSelect,
    titleCasePt,
    formatTelefone,
    prepUf,
    superintendencia,
    nomeArquivo,
    palavras,
    loadCartaDeps,
    readCartaUrls,
    ESPERA,
    precisaSessao,
    abrirModuloUsuarios,
    CAMPOS,
    TEXTOS,
    PREP_UF,
    PESQUISA_ANO,
    PERIODO_COLETA,
    SAUDACAO_PADRAO,
    PARAGRAFO_2_BIOMARCADORES,
    PARAGRAFO_2_ENTREVISTA,
    TAG,
  };
})();
