// SIGC-PRO feature: "Mapa" on Último Movimento — see agenda-lookups.js for
// the sibling feature this reuses the join pattern from (opt-in
// same-origin fetch of Lista de Endereços, controle|domicilio keying).
//
// Scope gate (2026-08-14, replacing the agência-only gate of
// 2026-08-10): the filter the user submitted is captured whole from
// #filtroJson on the Filtrar click, then replayed field-for-field onto
// the Lista de Endereços lookup — so agência, município and Controle
// scopes all resolve in ONE request, never one per Controle.
//
// The agência-only gate this replaces made the feature unusable for most
// profiles, which have no agência selector at all: #IdAgencia never held
// a single value for them, so the button was permanently disabled.
// Reading the submitted filter instead of one specific selector removes
// that whole class of profile difference.
//
// The only blocked case is a filter with NO geographic scope, whose
// coordinate lookup would fall back to the entire UF. Entrevistador and
// tipo-de-acompanhamento filters ride along fine inside a scope — they
// just narrow the rows further, and the join drops the surplus — but
// alone they mean the whole state, hence blocked. See motivoBloqueio.
// Spec: docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md
(function () {
  'use strict';

  const TAG = '[sigc-ultimo-movimento-map]';

  const ULTIMO_MOVIMENTO_MAP_LABELS = {
    controle: 'Controle',
    domicilio: 'Domicílio',
    entrevistador: 'Entrevistador',
    tipoEntrevista: 'Tipo Entrevista',
    ultimaPosicao: 'Última Posição',
    data: 'Data',
  };

  // headers/rows: plain string arrays from #tableRelatorio, same shape
  // ultimo-movimento-export.js and agenda-lookups.js already parse. Returns
  // null (not throw) when a required header is missing, so a live SIGC
  // column rename fails closed with a clear message at the call site,
  // never a silent wrong-column join.
  //
  // Folds accents (agenda-lookups.js's stripAccents) and strips the "#!"
  // sort/filter decoration some SIGC report grids prepend to a header
  // (agenda-lookups.js's stripHeaderMarker) before comparing — same table,
  // same live quirks agenda-lookups.js's own parseUltimoMovimentoTable
  // already accounts for (confirmed live: "Domicílio" with the accent,
  // occasionally "#!Domicílio"). Matching the accented label constant
  // literally, with no folding, silently failed every header check here
  // and made this feature unusable on the real page (2026-08-09).
  function parseUltimoMovimentoRows(headers, rows) {
    const P = window.__sigcPro;
    const AM = window.__sigcProAgendaLookups;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_MAP_LABELS)) {
      const expected = P.normalizeLabel(AM.stripAccents(ULTIMO_MOVIMENTO_MAP_LABELS[key]));
      const i = headers.findIndex(
        (h) => P.normalizeLabel(AM.stripAccents(AM.stripHeaderMarker(h))) === expected);
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      const domicilio = String(cells[idx.domicilio] || '').trim();
      if (!controle || !domicilio) return;
      map.set(`${controle}|${domicilio}`, {
        controle,
        domicilio,
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
        tipoEntrevista: String(cells[idx.tipoEntrevista] || '').trim(),
        ultimaPosicao: String(cells[idx.ultimaPosicao] || '').trim(),
        data: String(cells[idx.data] || '').trim(),
      });
    });
    return map;
  }

  // movimentoMap: from parseUltimoMovimentoRows. enderecosMap: from
  // agenda-lookups.js's tableToEnderecosMap (controle|domicilio ->
  // {lat, lon, zona, idZona}, already selecionados-only per its
  // TipoVisualizacao:'S' filtro). A household absent from enderecosMap
  // (fetch gap, or declined consent upstream) is NOT dropped — it keeps
  // its Último Movimento data with temCoordenadas/temZona both false, so
  // the popup's "sem coordenadas" count and the "Sem zona" bucket stay
  // accurate instead of silently undercounting.
  // incluirSoEnderecos (MODO_MOVIMENTO only): a selecionado present in
  // the Lista de Endereços but ABSENT from the movement report has not
  // been distributed — the report covers everything that left the base,
  // so absence from it IS the "Não Distribuído" state (which is also why
  // that posição never appears in the report's own rows). Joining these
  // households in gives their controles real rows, map markers (grey)
  // and a working pin, instead of a seeded zero row nothing can click.
  // NEVER on the biomarcadores variant: there the report is the
  // SUBSAMPLE, and endereços covers every selecionado — joining the
  // rest would flood the panel with households the page is not about.
  function joinEnderecos(movimentoMap, enderecosMap, incluirSoEnderecos) {
    const out = [];
    if (incluirSoEnderecos) {
      (enderecosMap || new Map()).forEach((info, key) => {
        if (movimentoMap.has(key)) return;
        const [controle, domicilio] = String(key).split('|');
        if (!controle || !domicilio) return;
        out.push({
          controle,
          domicilio,
          entrevistador: '',
          tipoEntrevista: '',
          // Derived, not read from a report cell — the Entenda tab says
          // so. Spelled exactly as POSICAO_NAO_DISTRIBUIDO's first form.
          ultimaPosicao: 'Não Distribuido',
          data: '',
          lat: info.lat ?? null,
          lon: info.lon ?? null,
          zona: info.zona || '',
          idZona: info.idZona || '',
          temCoordenadas: info.lat != null && info.lon != null,
          temZona: Boolean(info.idZona || info.zona),
        });
      });
    }
    movimentoMap.forEach((row, key) => {
      const info = enderecosMap.get(key) || null;
      const lat = info?.lat ?? null;
      const lon = info?.lon ?? null;
      // Falls back to the row's OWN zona when endereços has no entry for
      // it. The biomarcadores report carries Nome Zona per household, and
      // overwriting it unconditionally discarded the name wherever the
      // coordinate lookup missed. Endereços still wins where both exist:
      // it is the zona the map groups by.
      const zona = info?.zona || row.nomeZona || '';
      const idZona = info?.idZona || row.idZona || '';
      out.push({
        ...row,
        lat,
        lon,
        zona,
        idZona,
        temCoordenadas: lat != null && lon != null,
        temZona: Boolean(idZona || zona),
      });
    });
    return out;
  }

  // Agenda rows joined onto the already-coordinate-joined households, on
  // the same controle|domicilio key. Empty strings (never undefined) so
  // the renderers can write cells without guarding — the convention
  // lista-agenda.js's annotateRow established.
  // NEVER overwrites a booking the row already carries. On the
  // biomarcadores page `agendado` comes from the report's own Data
  // Agendada — authoritative, and free — so blanking it whenever the
  // agenda lookup missed showed "—" for a household SIGC says is booked.
  //
  // That is also why the agenda is fetched at all on that page: not for
  // per-household bookings, which the report already answers, but for
  // the FREE slots per zona, which it cannot know.
  function joinAgenda(joined, agendaIdx, todayIso) {
    const AM = window.__sigcProAgendaLookups;
    return (joined || []).map((r) => {
      if (r.agendado) return r;
      const slots = (agendaIdx && agendaIdx.get(`${r.controle}|${r.domicilio}`)) || [];
      const ag = AM.pickAgendado(slots, todayIso);
      return {
        ...r,
        agendado: ag ? AM.fmtAgendado(ag.data, ag.hora) : '',
        agendadoOrdenavel: ag ? ag.ordenavel : '',
        futura: ag ? ag.futura : false,
      };
    });
  }

  const TIPO_COLUNA = {
    'Realizada': 'realizada',
    'Não Iniciada': 'naoIniciada',
    'Domicílio Fechado': 'domicilioFechado',
    'Recusa': 'recusa',
  };

  // The real ultimaPosicao domain, enumerated over all 26.203 rows of BA
  // movimento.parquet (pns.zonas, 2026-08-14): Distribuido, Enviado para
  // Carga, Descarregado, Descarregado Parcialmente, Reentrevista. There
  // is NO 'Transmitido' — an earlier version of this rule was written
  // against that assumed value.
  //
  // Row COUNTS elsewhere in this file are of the current state (until_ts
  // IS NULL, 7.140 rows in BA), not of this raw history — enumerating a
  // domain wants every version ever seen, counting a population wants
  // one row per household. Conflating the two is what produced the wrong
  // percentages this file used to cite.
  const POSICAO_DISTRIBUIDO = 'Distribuido';

  // Household demand, in two measures — deliberately not one.
  //
  // The operative one: 'Realizada' whose posição is 'Descarregado
  // Parcialmente' or 'Reentrevista', with no agendamento. Both are
  // states where the interview came through but the biomarcador
  // collection did not — exactly the visit that still has to be
  // scheduled.
  //
  // Matched POSITIVELY on those two states, never as "anything that
  // isn't Descarregado": that negative form would also admit
  // 'Distribuido' and 'Enviado para Carga', which are not owed anything
  // yet, and would silently absorb any new posição SIGC introduces.
  //
  // Both states verified against biomarcadores.parquet (BA, 2026-08-14),
  // scoring the share whose biomarcador status is still open (A agendar
  // / Não iniciado / Agendado / Indefinido).
  //
  // Denominator: households in the biomarcador SUBSAMPLE whose
  // tipo_entrevista is 'Realizada' — only they can owe anything — in the
  // CURRENT state (until_ts IS NULL) of both parquets:
  //
  //   Descarregado Parcialmente  89,7% em aberto (96/107)  <- owed
  //   Reentrevista               86,4% em aberto (19/22)   <- owed
  //   Descarregado (completo)    33,0% em aberto (86/261)  <- closed
  //
  // Stating the denominator is not optional here: an earlier version of
  // this comment cited 60/53/32%, measured over the raw SCD history,
  // where superseded rows count — a household that passed through
  // 'Descarregado Parcialmente' and is now 'Descarregado' still scored as
  // owed. (Over the current state but with ALL 'Realizada' in the
  // denominator, the figures would be 32,5/25,0/7,1% — also wrong, since
  // that admits households that never owed a collection at all.)
  //
  // Reentrevista tracks the partial state, not the completed one, which
  // is why it belongs here — an earlier version of this rule excluded it
  // on the assumption that a re-interview owes no collection. Note it now
  // sits just BELOW Descarregado Parcialmente rather than above; what
  // matters is that both sit far above the completed 33,0%.
  //
  // This pair of posições is a PROXY, and only that. The authoritative
  // source is the Relatório de Acompanhamento de Biomarcadores, whose
  // literal `status` this extension now reads on its own page — see
  // MODO_BIOMARCADORES. Measured against it in BA: of 121 households the
  // proxy called owed, 11 were already collected and 4 refused; of those
  // it called closed, 81 were still open. It errs in both directions.
  //
  // (An earlier version of this comment claimed that source "covers only
  // ~48% of these households", and used that to justify staying on the
  // proxy. It was false — biomarcadores.parquet covers 100% of the
  // subsample, 1.860 of 1.860 rows in BA, every one with a status. The
  // real reason to keep the proxy is narrower: this report is a different
  // page, and Último Movimento cannot reach it.)
  const POSICAO_BIOMARCADOR_DEVIDO = new Set(
    ['Descarregado Parcialmente', 'Reentrevista']);

  function isRealizadaSemAgendamento(r) {
    return r.tipoEntrevista === 'Realizada' &&
      POSICAO_BIOMARCADOR_DEVIDO.has(r.ultimaPosicao) &&
      !r.agendado;
  }

  // The broader context column: unscheduled households already in the
  // field, whatever their tipo. Kin to pns.zonas'
  // scripts/relatorio_agenda.R `pendentes`, and useful as the backdrop
  // the operative number sits against.
  //
  // Excluded, in both cases because nothing is owed YET rather than
  // because the household is finished:
  //   'Distribuido'        — handed to the device, not yet worked. The
  //                          R script's "não é fila intocada".
  //   'Enviado para Carga' — queued for loading, same reasoning
  //                          (800 rows in BA in the current state, all
  //                          Não Iniciada; an earlier version of this
  //                          comment said 3.582, which counted the raw
  //                          SCD history including superseded rows).
  //
  // Deliberately NOT filtered by tipo_entrevista. An earlier version
  // whitelisted four tipos, written against an assumed domain: the live
  // table carries 12 in BA, among them 'Uso Ocasional' (47) and
  // 'Domicílio Vago'. Enumerating them invites exactly the silent
  // undercount that whitelist produced.
  //
  // (That earlier version also cited 'Em condições de ser habitada' and
  // 'Em Ruínas'. Neither string exists in any of the four UFs — the real
  // value is 'Em obras ou ruínas', 8 rows in BA. They appeared only in
  // this comment, never in a constant, so nothing was matching nothing.)
  //
  // Every household in isRealizadaSemAgendamento is also in here (both
  // its posições are past distribution), so the two columns are nested,
  // never disjoint — the header tooltip says so, or a reader tries to
  // add them up.
  // 'Não Distribuido' never appears in the parquet history (all 13 UFs,
  // superseded rows included — the five values above are the whole
  // recorded domain), but the SIGC UI can show it for a questionário
  // that never left the base. With no row to copy the spelling from,
  // the plausible case/accent forms are all matched.
  const POSICAO_NAO_DISTRIBUIDO = new Set([
    'Não Distribuido', 'Não Distribuído', 'Não distribuido', 'Não distribuído']);

  const POSICAO_NAO_EM_CAMPO = new Set([POSICAO_DISTRIBUIDO, 'Enviado para Carga',
    ...POSICAO_NAO_DISTRIBUIDO]);

  function isPendente(r) {
    if (r.agendado) return false;
    return !POSICAO_NAO_EM_CAMPO.has(r.ultimaPosicao);
  }

  // joined: from joinAgenda (carries `agendado`). enderecosMap: the
  // agência-complete controle|domicilio -> {lat, lon, zona, idZona} map
  // (see joinEnderecos above) — seeded here FIRST, before folding in
  // `joined`, so a zona with addresses/coordinates but zero movimento
  // rows (nothing collected yet) still gets a bucket, all zeros, instead
  // of silently disappearing. Denominator throughout is selecionados:
  // the Lista de Endereços response is already selecionados-only, so no
  // extra filtering happens here.
  //
  // One output row per distinct idZona (from either source), plus
  // exactly one row with idZona===null aggregating every movimento row
  // whose temZona is false (non-biomarcador selecionados — see spec
  // "Selecionados without zona"). Never silently drops a movimento row:
  // every row in `joined` lands in exactly one output row.
  // WHAT A ROW OF THE AGGREGATE TAB IS, per variant.
  //
  // Biomarcadores groups by zona because that is the unit the AGENDA is
  // built on: slots are created per zona, so "does this group have
  // capacity" is only answerable there. Último Movimento asks no agenda
  // question — it has no slots, no demand and no déficit — and grouping
  // it by zona borrowed a unit it had no use for. Its natural unit is
  // the CONTROLE: the survey's own sampling unit, the thing an
  // interviewer is assigned and the report itself is keyed by.
  //
  // Everything downstream (hulls, the pin, the row click, the CSV) reads
  // this one field, so the two variants share every line of the
  // aggregation and differ only in what they group by.
  const GRUPO = {
    movimento: {
      campo: 'controle',
      // A Controle is a 15-digit code with no name in SIGC, so there is
      // no second column to show beside it — unlike a zona, which has
      // one. Aggregation still fills nomeGrupo (with the id) so every
      // consumer can read the same two fields regardless of variant.
      rotulo: 'Controle',
      rotuloPlural: 'Controles',
      temNome: false,
      semGrupoLabel: 'Sem controle',
    },
    biomarcadores: {
      campo: 'idZona',
      rotulo: 'Zona',
      rotuloPlural: 'Zonas',
      temNome: true,
      semGrupoLabel: 'Sem zona',
    },
  };

  function grupoDe(modo) {
    return GRUPO[(modo || MODO_MOVIMENTO).id] || GRUPO.movimento;
  }

  // Third grouping, shared by BOTH variants: the Entrevistadores tab
  // buckets by the report's own Entrevistador column (on biomarcadores
  // it rides the same Último Movimento consulta that fills Última
  // Posição). Not in GRUPO: that map answers "what does this VARIANT
  // group its Zonas tab by", while this one is passed explicitly as an
  // override to aggregateZonas.
  const GRUPO_ENTREVISTADOR = {
    campo: 'entrevistador',
    rotulo: 'Entrevistador',
    rotuloPlural: 'Entrevistadores',
    temNome: false,
    semGrupoLabel: 'Sem entrevistador',
  };

  // The grouping key of a row, and whether it has one at all. A row with
  // no zona is real (households arrive before zona assignment); a row
  // with no controle is not, but the same shape covers both.
  function chaveGrupo(r, g) {
    if (g.campo === 'controle') {
      const c = (r && r.controle) || '';
      return { tem: !!c, id: c || null, nome: c || null };
    }
    if (g.campo === 'entrevistador') {
      // Blank is real here: a household still in distribution has no
      // entrevistador on the report, and on biomarcadores a failed
      // posições fetch leaves every row blank — both land in the
      // "Sem entrevistador" bucket rather than vanishing.
      const s = String((r && r.entrevistador) || '').trim();
      return { tem: !!s, id: s || null, nome: s || null };
    }
    return {
      tem: !!(r && r.temZona), id: (r && r.idZona) || null,
      nome: (r && r.zona) || null,
    };
  }

  function aggregateZonas(joined, enderecosMap, modo, hojeIso, grupoOverride) {
    const m = modo || MODO_MOVIMENTO;
    const g = grupoOverride || grupoDe(m);
    const byZona = new Map(); // key: group id || special string
    const SEM_ZONA_KEY = '__SEM_ZONA__';
    // idZona/nomeZona keep their names through the whole pipeline even
    // when they hold a Controle: renaming them would touch every
    // consumer, every test and the CSV headers for no gain — the label
    // the reader sees comes from GRUPO.rotulo, not from these keys.
    const novoBucket = (idZona, nomeZona) => ({
      idZona, nomeZona,
      realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0,
      naoDistribuida: 0,
      // The nine-column partition (MODO_BIOMARCADORES) — see
      // classificaDomicilio. Every household increments exactly one.
      aEntrevistar: 0, emAndamento: 0, inelegivel: 0, semAgendamento: 0,
      agendamentoPendente: 0, agendadoBio: 0, coletado: 0,
      recusaBiomarcador: 0, recusaEntrevista: 0, semEntrevista: 0,
      // A subset of agendamentoPendente, not a tenth column: a queue of
      // 29 fresh and one of 29 already blown demand different staffing,
      // and merged they looked identical.
      vencidos: 0,
      totalDomicilios: 0, semCoordenadas: 0, agendados: 0,
      realizadasSemAgendamento: 0, pendentes: 0,
      aAgendar: 0, jaAgendados: 0,
      // Only filled when grouping by entrevistador: the distinct
      // controles (movimento) or zonas (biomarcadores) this person has
      // households in — the "where does their work sit" cell.
      grupos: new Set(),
    });

    // Seed from the address list so a group with no fieldwork yet still
    // gets a row — a zona (or controle) missing from a MOVEMENT report is
    // precisely the one where nothing has moved, which is the row a
    // supervisor most needs to see. No seeding for the entrevistador
    // grouping: the address list carries no roster of people without
    // work, and an entrevistador with zero households is not a row this
    // table can know about.
    (enderecosMap && g.campo !== 'entrevistador' ? enderecosMap : new Map())
      .forEach((info, chave) => {
      if (g.campo === 'controle') {
        // enderecosMap is keyed "controle|domicilio"; the controle is the
        // half before the pipe.
        const id = String(chave || '').split('|')[0];
        if (!id) return;
        if (!byZona.has(id)) byZona.set(id, novoBucket(id, id));
        return;
      }
      const id = info && info.idZona;
      if (!id) return;
      if (!byZona.has(id)) byZona.set(id, novoBucket(id, info.zona || id));
    });

    (joined || []).forEach((r) => {
      const gk = chaveGrupo(r, g);
      const key = gk.tem ? gk.id : SEM_ZONA_KEY;
      if (!byZona.has(key)) {
        byZona.set(key, novoBucket(gk.tem ? gk.id : null,
          gk.tem ? (gk.nome || gk.id) : g.semGrupoLabel));
      }
      const bucket = byZona.get(key);
      // On Último Movimento each column is the report's own Tipo
      // Entrevista, verbatim. The one posição-based column is the
      // literal 'Não Distribuido' — a questionário the base never sent
      // out is not fieldwork in any state. An earlier version also
      // filed 'Distribuido' and 'Enviado para Carga' under "Não
      // distribuída", which put a household whose posição literally
      // reads 'Distribuido' in a column named the opposite.
      // On the biomarcadores page the columns are collection states (see
      // classificaDomicilio); on Último Movimento they stay interview
      // outcomes, which is all that report carries.
      if (m.comDemanda) {
        const CHAVE = {
          coletado: 'coletado', agendado: 'agendadoBio',
          recusaBiomarcador: 'recusaBiomarcador',
          recusaEntrevista: 'recusaEntrevista',
          semEntrevista: 'semEntrevista', inelegivel: 'inelegivel',
          agendamentoPendente: 'agendamentoPendente',
          semAgendamento: 'semAgendamento', aEntrevistar: 'aEntrevistar',
          emAndamento: 'emAndamento',
        };
        const classe = classificaDomicilio(r, hojeIso);
        bucket[CHAVE[classe]] += 1;
        if (classe === 'agendamentoPendente') {
          const dias = diasParaPrazo(r, hojeIso);
          if (dias !== null && dias < 0) bucket.vencidos += 1;
        }
      } else {
        const coluna = POSICAO_NAO_DISTRIBUIDO.has(r.ultimaPosicao)
          ? 'naoDistribuida'
          : (TIPO_COLUNA[r.tipoEntrevista] || 'outros');
        bucket[coluna] += 1;
      }
      bucket.totalDomicilios += 1;
      if (!r.temCoordenadas) bucket.semCoordenadas += 1;
      if (r.agendado) bucket.agendados += 1;
      // Which areas this entrevistador's households sit in — the unit
      // each variant's OWN Zonas tab uses (zona on biomarcadores,
      // controle on movimento), so the two tabs cross-reference.
      if (g.campo === 'entrevistador') {
        const area = m.comDemanda ? r.idZona : r.controle;
        if (area) bucket.grupos.add(area);
      }
      // On the biomarcadores page the demand is the literal `status`, not
      // the ultimaPosicao proxy — which is empty there anyway, so keeping
      // the proxy rule would silently report zero demand.
      if (m.comDemanda ? deveColeta(r, hojeIso) : isRealizadaSemAgendamento(r)) {
        bucket.realizadasSemAgendamento += 1;
      }
      if (m.comDemanda ? coletaEmAberto(r, hojeIso) : isPendente(r)) {
        bucket.pendentes += 1;
      }
      // The two columns the biomarcadores table actually shows, split so
      // they are DISJOINT and therefore add up: "a agendar" needs action
      // now, "já agendados" is on its way. Nested measures (the pair
      // above) always need a "do not sum these" warning, and that warning
      // is the part a reader skips.
      //
      // A lapsed booking is in the first, not the second: coletaEmAberto
      // reopens it once the date passes, so a stale Data Agendada can
      // never read as work in progress.
      //
      // "A agendar" means SCHEDULABLE, which is narrower than "open":
      // deveColeta also requires the interview to have concluded as
      // 'Realizada'. The collection follows the interview, so a household
      // nobody has visited — or one whose interview found no resident —
      // cannot be booked, however open its status. Counting merely-open
      // households put 1.629 in this column in BA when 170 were
      // actionable, which is the R's `realizadas_sem_agendamento`
      // (relatorio_agenda.R:345).
      if (m.comDemanda) {
        if (deveColeta(r, hojeIso)) bucket.aAgendar += 1;
        else if (r.status === STATUS_AGENDADO && !coletaEmAberto(r, hojeIso)) {
          bucket.jaAgendados += 1;
        }
      }
    });

    return Array.from(byZona.values());
  }

  const SEM_ZONA_COLOR = '#888888';
  // Categorical palette (Okabe-Ito, colorblind-safe — same family used
  // by the day-route SVG maps elsewhere in this extension), cycled by a
  // deterministic hash so the same idZona always gets the same color
  // within one render and across re-renders.
  const ZONA_PALETTE = [
    '#0072B2', '#D55E00', '#009E73', '#CC79A7',
    '#E69F00', '#56B4E9', '#F0E442', '#000000',
  ];

  function zonaColor(idZona) {
    if (!idZona) return SEM_ZONA_COLOR;
    let hash = 0;
    for (let i = 0; i < idZona.length; i += 1) {
      hash = (hash * 31 + idZona.charCodeAt(i)) | 0;
    }
    return ZONA_PALETTE[Math.abs(hash) % ZONA_PALETTE.length];
  }

  // Marker color = status (spec: docs/superpowers/specs/
  // 2026-08-09-mapa-status-zonas-controles-design.md §1), not zona —
  // zonaColor() is still used, but now only for the hull layer.
  // Okabe-Ito colorblind-safe hex values, assigned by semantic
  // convention here (unlike zonaColor's arbitrary hash) since status
  // carries real meaning a survey manager reads at a glance.
  const STATUS_INATIVO = '#888888';
  const STATUS_REALIZADA = '#009E73';
  const STATUS_RECUSA = '#D55E00';
  const STATUS_NAO_INICIADA = '#F0E442';
  const STATUS_FECHADO = '#56B4E9';
  const STATUS_OUTROS = '#000000';

  const STATUS_TIPO_COLOR = {
    'Realizada': STATUS_REALIZADA,
    'Recusa': STATUS_RECUSA,
    'Não Iniciada': STATUS_NAO_INICIADA,
    'Domicílio Fechado': STATUS_FECHADO,
  };

  // --- The nine-column partition (MODO_BIOMARCADORES) --------------------
  //
  // One column per household, summing to Total. The old set answered the
  // wrong question: it counted INTERVIEW outcomes on a page about
  // COLLECTIONS, so 76% of households landed in "Outros" and the
  // actionable queue read 170 when 29 could actually be booked.
  //
  // Read left to right as a pipeline, with the two dead ends pulled out:
  //   A entrevistar -> Em campo (indefinida) -> Sem agendamento
  //   iniciado -> Agendamento pendente -> Agendado -> Coletado
  //   (Inelegível and Encerrado sem entrevista leave the pipeline.)
  //
  // Counts below are BA on 2026-08-15, measured against the parquet.
  const TIPO_SEM_MORADOR = new Set([
    'Domicílio Vago', 'Uso Ocasional', 'Domicílio Fechado', 'Demolida',
    'Em obras ou ruínas', 'Não Residencial', 'Não Foi Encontrado', 'Outro Motivo',
  ]);

  function temPrazo(r) {
    return !!String((r && r.dataFinalColeta) || '').trim();
  }

  // ORDER IS LOAD-BEARING. 47 BA households are 'Agendado' AND have a
  // deadline; the 36 future-dated must be claimed as `agendado` before
  // the deadline rule runs, or they would inflate the actionable queue.
  // Likewise a biomarcador outcome wins over an unfinished interview —
  // a booked collection is the fact a supervisor acts on.
  function classificaDomicilio(r, hojeIso) {
    const status = (r && r.status) || '';
    const tipo = (r && r.tipoEntrevista) || '';
    const posicao = (r && r.ultimaPosicao) || '';

    if (STATUS_COLETADO.has(status)) return 'coletado';                    // 128
    if (status === STATUS_AGENDADO && !coletaEmAberto(r, hojeIso)) {
      return 'agendado';                                                   // 40
    }
    // A lapsed 'Agendado' WITHOUT a concluded interview deliberately
    // falls through to 'emAndamento', not the pendente queue: the
    // booking proves 25A.01 was once reached, but not that rebooking is
    // the next step. The one real BA case (292740805060022/15) was a
    // Realizada rolled back to Reentrevista — the field is still working
    // it — and an interview done in the wrong domicílio can also reach
    // agendamento. "Reagendar" on either would be a wrong instruction.
    // The two refusals are different jobs — persuading someone about a
    // blood draw is not persuading them about the survey — and the map
    // has always drawn them apart (#D55E00 vs #A63603). A household that
    // refused BOTH counts once, under the biomarcador: R lets its two
    // columns overlap (51 + 18 over 68 households), but these must sum to
    // Total, and the biomarcador refusal is the one blocking the
    // collection this page is about.
    if (status === 'Recusa') return 'recusaBiomarcador';                   // 51
    if (tipo === 'Recusa') return 'recusaEntrevista';                      // 17
    if (status === 'Outro Motivo' || status === 'Não elegível' ||
        TIPO_SEM_MORADOR.has(tipo)) {
      return 'semEntrevista';                                              // 43
    }
    // Interview finished, fully transmitted, and the biomarcador was
    // never opened — no visit, no scheduler, no deadline. In BA 69 of
    // these 74 have a selected resident under 35, below the eligibility
    // floor (minimum age ever collected: 35). Requiring Descarregado is
    // what makes the inference safe: among partially-transmitted
    // households the age mix is nearly even, so including them would be
    // wrong about as often as right.
    if (tipo === 'Realizada' && posicao === 'Descarregado' &&
        status === 'Não iniciado' && !temPrazo(r)) {
      return 'inelegivel';                                                 // 74
    }
    if (tipo === 'Realizada') {
      // The deadline is born from item 25A.01 — "ENTREVISTADOR(A): Deseja
      // iniciar o agendamento para a coleta de sangue e urina?", the last
      // module of the questionnaire. Its presence is what separates a
      // collection already under way from one never begun.
      return temPrazo(r) ? 'agendamentoPendente' : 'semAgendamento';       // 29 / 67
    }
    if (POSICAO_NAO_EM_CAMPO.has(posicao)) return 'aEntrevistar';          // 1.192
    return 'emAndamento';                                                  // 219
  }

  // The label for each class, shared by both tabs so a Zonas column and
  // a Domicílios row never call the same state by different names.
  const CLASSE_LABEL = {
    aEntrevistar: 'A entrevistar',
    emAndamento: 'Em campo (indefinida)',
    semAgendamento: 'Sem agendamento iniciado',
    agendamentoPendente: 'Agendamento pendente',
    agendado: 'Agendado',
    coletado: 'Coletado',
    recusaBiomarcador: 'Recusa do biomarcador',
    recusaEntrevista: 'Recusa da entrevista',
    inelegivel: 'Inelegível',
    semEntrevista: 'Encerrado sem entrevista',
  };

  // What to DO about a household, for every class — not only the ones
  // inside the deadline window. The old Ação column filled only when the
  // prazo alert fired, so it was blank for most rows, including work that
  // genuinely needed doing but had no deadline yet.
  //
  // Empty string where nothing is owed: a finished or terminal household
  // should show a dash, not an instruction.
  const CLASSE_ACAO = {
    aEntrevistar: 'entrevistar',
    emAndamento: 'concluir entrevista',
    semAgendamento: 'concluir 25A.01',
    agendamentoPendente: 'agendar',
    agendado: '',
    coletado: '',
    recusaBiomarcador: 'reverter recusa do biomarcador',
    recusaEntrevista: 'reverter recusa da entrevista',
    inelegivel: '',
    semEntrevista: '',
  };

  // 'Agendado' whose date has passed is back in the queue — reagendar,
  // not agendar, because there is a booking on file to move.
  function acaoDoDomicilio(r, hojeIso) {
    const classe = classificaDomicilio(r, hojeIso);
    if (classe === 'agendamentoPendente' && (r && r.status) === STATUS_AGENDADO) {
      return 'reagendar';
    }
    if (classe === 'agendamentoPendente' && (r && r.status) === 'Indefinido') {
      return 'definir situação';
    }
    return CLASSE_ACAO[classe] || '';
  }

  // What a zona hull says when clicked. The R's equivalent carries route
  // and lab data from an OSRM cache this extension has no access to
  // (map_corredores.R:232-239), so this answers the question the panel
  // can actually answer: what is in this zona, and can it be booked.
  //
  // Ordered like the Zonas columns — pipeline first, then the two dead
  // ends — so the popup and the table tell the same story in the same
  // order.
  function buildZonaPopupHtml(z, turnos, grupos, modo) {
    const m = modo || MODO_BIOMARCADORES;
    const esc = window.__sigcPro.escapeHtml;
    const AM = window.__sigcProAgendaLookups;
    const t = turnos || {};
    const linha = (rotulo, valor) =>
      (valor ? `${esc(rotulo)}: <b>${valor}</b><br>` : '');
    const nome = z.nomeZona && z.nomeZona !== z.idZona
      ? ` — ${esc(z.nomeZona)}` : '';
    return (
      `<b>${esc(z.idZona || grupoDe(m).semGrupoLabel)}</b>${nome}<br>` +
      `${z.totalDomicilios} domicílio(s)` +
      // The count the tables no longer carry as a column: shown only
      // when nonzero, since "0 sem coordenadas" is the normal case and
      // would be noise on every popup.
      (z.semCoordenadas ? ` (${z.semCoordenadas} sem coordenadas)` : '') +
      '<br><br>' +
      // Each variant's own counts. Listing the biomarcador ones on
      // Último Movimento printed a header, a blank gap and a slots line
      // that variant never has — every field was undefined there.
      (m.comDemanda ? '' :
        linha('Não distribuída', z.naoDistribuida) +
        linha('Realizada', z.realizada) +
        linha('Não Iniciada', z.naoIniciada) +
        linha('Dom. Fechado', z.domicilioFechado) +
        linha('Recusa entrev.', z.recusa) +
        linha('Outros', z.outros)) +
      linha('A entrevistar', z.aEntrevistar) +
      linha('Em campo (indefinida)', z.emAndamento) +
      linha('Sem agendamento iniciado', z.semAgendamento) +
      // The actionable number, with the overdue share beside it: a queue
      // of 8 with 3 already blown is not the same job as 8 fresh.
      (z.agendamentoPendente
        ? `Agendamento pendente: <b>${z.agendamentoPendente}</b>` +
          (z.vencidos ? ` (${z.vencidos} vencido(s))` : '') + '<br>'
        : '') +
      linha('Agendado', z.agendadoBio) +
      linha('Coletado', z.coletado) +
      linha('Recusa do biomarcador', z.recusaBiomarcador) +
      linha('Recusa da entrevista', z.recusaEntrevista) +
      linha('Inelegível', z.inelegivel) +
      linha('Encerrado sem entrevista', z.semEntrevista) +
      (m.comSlots
        ? `<br>Slots livres: ${(t.manha || 0)} manhã, ${(t.tarde || 0)} tarde<br>` +
          AM.buildSlotsLivresHtml(grupos || [])
        : '')
    );
  }

  // --- Agência layers ----------------------------------------------------
  //
  // One toggleable marker layer per agência, so a supervisor covering
  // several can isolate one at a time. Only the household markers are
  // grouped: hulls, Controle labels and the leader lines stay on the base
  // map, since they answer "where is this zona" rather than "whose work
  // is this".
  //
  // Agência comes from the biomarcadores report's own column. Último
  // Movimento has no such column, so everything there lands in the single
  // "Sem agência" bucket and the control is suppressed (see
  // valeControleDeCamadas).
  const SEM_AGENCIA = 'Sem agência';

  function agruparPorAgencia(rows) {
    const grupos = new Map();
    (rows || []).forEach((r) => {
      const chave = String((r && r.agencia) || '').trim() || SEM_AGENCIA;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(r);
    });
    // Sorted so the control's order is stable across renders — an
    // insertion-ordered list would shuffle whenever the report did.
    return new Map([...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  // A control with one checkbox toggles nothing and just costs a corner
  // of the map. The scope gate already requires agência/município/
  // controle, so one agência is the common case, not an edge case.
  function valeControleDeCamadas(grupos) {
    return grupos.size > 1;
  }

  // --- Marker size, by zoom ---------------------------------------------
  //
  // A fixed radius cannot work at both ends: with thousands of markers,
  // 9px is a solid smear at state level (nothing is distinguishable) and
  // wider than the building at street level. Ports the interpolation from
  // pns.zonas' map_corredores.R:1262-1268 — 3px at zoom 9 up to 13px at
  // zoom 18, with urgent markers ~50% larger at every stop so they keep
  // standing out without blowing up close in.
  //
  // Clamped, not extrapolated: a world-level zoom must not produce a
  // negative radius.
  const RAIO_POR_ZOOM = [
    { zoom: 9, normal: 3, urgente: 4.5 },
    { zoom: 13, normal: 6, urgente: 9 },
    { zoom: 16, normal: 9, urgente: 14 },
    { zoom: 18, normal: 13, urgente: 19 },
  ];

  function raioPorZoom(zoom, urgente) {
    const chave = urgente ? 'urgente' : 'normal';
    const pontos = RAIO_POR_ZOOM;
    if (zoom <= pontos[0].zoom) return pontos[0][chave];
    const ultimo = pontos[pontos.length - 1];
    if (zoom >= ultimo.zoom) return ultimo[chave];
    for (let i = 1; i < pontos.length; i += 1) {
      const a = pontos[i - 1];
      const b = pontos[i];
      if (zoom <= b.zoom) {
        const t = (zoom - a.zoom) / (b.zoom - a.zoom);
        return a[chave] + t * (b[chave] - a[chave]);
      }
    }
    return ultimo[chave];
  }

  // The needs-action fill is yellow, and a white stroke vanishes against
  // it — the R hit exactly this and switched the urgent marker to a dark
  // halo (map_corredores.R:1274-1277).
  const BORDA_URGENTE = '#7A0177';

  function corDaBorda(urgente) {
    return urgente ? BORDA_URGENTE : 'white';
  }

  // Worth a bigger, haloed marker: the household needs action before its
  // deadline closes. Reuses emAlertaDePrazo so the map and the Domicílios
  // table can never disagree about who is urgent.
  //
  // Only in MODO_BIOMARCADORES: Último Movimento has no deadline data at
  // all, so nothing there can be urgent.
  function marcadorUrgente(row, modo, hojeIso) {
    const m = modo || MODO_MOVIMENTO;
    if (!m.comDemanda) return false;
    return emAlertaDePrazo(row, hojeIso);
  }

  // --- Biomarcador collection palette (MODO_BIOMARCADORES) --------------
  //
  // Okabe-Ito throughout, same family as the zona palette. Ports the
  // `tem_bio` branch of pns.zonas' map_corredores.R:650-678.
  const BIO_COLETADO = '#009E73';        // verde   — pronto
  const BIO_AGENDADO = '#0072B2';        // azul    — encaminhado
  const BIO_ACAO = '#F0E442';            // amarelo — precisa de agenda
  const BIO_RECUSA_COLETA = '#D55E00';   // laranja
  const BIO_RECUSA_ENTREVISTA = '#A63603'; // vermelho escuro
  const BIO_OUTRO_MOTIVO = '#882255';    // roxo
  const BIO_NAO_ELEGIVEL = '#000000';    // preto
  const BIO_BLOQUEADO = '#E69F00';       // âmbar   — ocupado, sem entrevista
  const BIO_NAO_INICIADO = '#999999';    // cinza   — esperando a vez
  const BIO_DESCONHECIDO = '#CC79A7';    // rosa    — status não reconhecido

  // Interview outcomes a revisit can still turn around. A household whose
  // collection is "Não iniciado" for one of these is not queued — it is
  // BLOCKED behind the interview, and that is worth its own colour.
  //
  // Deliberately short: 'Uso Ocasional' (second home) and 'Domicílio Vago'
  // (empty) are excluded because there is nobody to interview, so there is
  // nothing to reverse; 'Em obras ou ruínas', 'Demolida' and 'Não
  // Residencial' are not dwellings at all; 'Outro Motivo' records no
  // reason, so occupancy cannot be asserted. Mirrors TIPOS_REVERSIVEIS
  // (map_corredores.R:638).
  const TIPOS_REVERSIVEIS = new Set(['Recusa', 'Domicílio Fechado', 'Não Foi Encontrado']);

  // In MODO_MOVIMENTO the interview outcome is the only thing on screen,
  // so colouring by it is right. In MODO_BIOMARCADORES it is actively
  // misleading: a household that refused the COLLECTION usually has a
  // successful interview, and would render green — identical to one
  // already collected (~50 such households in BA).
  //
  // Matched positively, like every other status rule here: an unrecognized
  // status gets BIO_DESCONHECIDO rather than falling into a real category.
  function statusColor(row, modo, hojeIso) {
    const m = modo || MODO_MOVIMENTO;
    if (!m.comDemanda) {
      // Same rule as the Zonas columns: the colour follows the report's
      // own Tipo Entrevista, and only the literal 'Não Distribuido'
      // posição is inactive grey — a questionário the base never sent
      // out. 'Distribuido'/'Enviado para Carga' take their tipo's
      // colour like every other row.
      if (POSICAO_NAO_DISTRIBUIDO.has(row.ultimaPosicao)) return STATUS_INATIVO;
      return STATUS_TIPO_COLOR[row.tipoEntrevista] || STATUS_OUTROS;
    }
    const s = (row && row.status) || '';
    if (STATUS_COLETADO.has(s)) return BIO_COLETADO;
    if (s === STATUS_AGENDADO) {
      // A booking that lapsed without a collection is demand again, so it
      // takes the needs-action colour rather than keeping "encaminhado"
      // blue — the same reopening coletaEmAberto applies.
      return coletaEmAberto(row, hojeIso) ? BIO_ACAO : BIO_AGENDADO;
    }
    if (s === 'Recusa') return BIO_RECUSA_COLETA;
    // Why it has not started matters more than that it has not. The
    // interview refusal gets a colour of its own, distinct from the
    // collection refusal above: reverting one means arguing for the
    // exam, the other for the whole survey — different work.
    //
    // Checked before the remaining biomarcador statuses, not only inside
    // 'Não iniciado', because a refused interview is a fact about the
    // interview: it stays true whether the biomarcador side reads
    // 'A agendar', 'Indefinido', 'Outro Motivo' or nothing at all. Held
    // inside 'Não iniciado' this disagreed with classificaDomicilio,
    // which has always claimed every tipo === 'Recusa' for the column —
    // so the map drew as demand what the table counted as a refusal.
    const tipoEntrev = (row && row.tipoEntrevista) || '';
    if (tipoEntrev === 'Recusa') return BIO_RECUSA_ENTREVISTA;
    if (s === 'Outro Motivo') return BIO_OUTRO_MOTIVO;
    if (s === 'Não elegível') return BIO_NAO_ELEGIVEL;
    if (s === 'A agendar' || s === 'Indefinido') return BIO_ACAO;
    if (s === 'Não iniciado') {
      if (TIPOS_REVERSIVEIS.has(tipoEntrev)) return BIO_BLOQUEADO;
      return BIO_NAO_INICIADO;
    }
    return BIO_DESCONHECIDO;
  }

  // A zona row is clickable (opens the Mapa tab focused on that zona)
  // only when it has at least one domicílio WITH valid coordinates —
  // semCoordenadas < totalDomicilios. A row where every domicílio lacks
  // coordinates has nothing for fitBounds to focus on, so it's left
  // static rather than inviting a click that silently does nothing.
  function zonaRowIsClickable(r) {
    return r.totalDomicilios > r.semCoordenadas;
  }

  // --- The two map variants --------------------------------------------
  //
  // Same panel, same joins, two hosts — deliberately NOT a migration.
  //
  // MODO_MOVIMENTO (Último Movimento): the report on screen carries
  // tipoEntrevista/ultimaPosicao but nothing about biomarcador
  // collection, and this variant makes NO agenda request. One fetch
  // (Lista de Endereços, for coordinates), so it works for any
  // controle/município/agência at the cost of every agenda-derived
  // column.
  //
  // MODO_BIOMARCADORES (Relatório de Acompanhamento de Biomarcadores):
  // demand comes from the literal `status`, and `agendado` from the
  // report's own Data Agendada — authoritative and free, no agenda
  // needed for it. The agenda is still fetched, but ONLY for free slots
  // per zona, which the report cannot know.
  //
  // Columns are declared here rather than branched at each use: a column
  // present in the header and missing from the body (or the reverse)
  // silently shifts every later cell, so both come from one list.
  const MODO_MOVIMENTO = {
    id: 'movimento',
    comAgenda: false,     // no agenda request at all
    comDemanda: false,    // no agenda -> "sem agendamento" is unknowable
    comSlots: false,
  };

  const MODO_BIOMARCADORES = {
    id: 'biomarcadores',
    comAgenda: true,      // for free slots only
    comDemanda: true,
    comSlots: true,
  };

  // --- Biomarcador collection status ------------------------------------
  //
  // Matched POSITIVELY, exactly as the posições are: a status SIGC adds
  // tomorrow must fall out of the counts and be reported, never be
  // absorbed by a negation of "Coletado". Mirrors pns.zonas'
  // STATUS_BIOMARCADOR_ABERTO / _FECHADO_SEM_COLETA
  // (R/sigc_biomarcadores.R:52,68).
  const STATUS_ABERTO = new Set(['A agendar', 'Não iniciado', 'Indefinido']);
  const STATUS_COLETADO = new Set([
    'Coletado Sangue e Urina', 'Coletado apenas Sangue', 'Coletado apenas Urina',
  ]);
  const STATUS_FECHADO_SEM_COLETA = new Set(['Recusa', 'Outro Motivo', 'Não elegível']);
  const STATUS_AGENDADO = 'Agendado';

  function statusDesconhecido(r) {
    const s = (r && r.status) || '';
    return !STATUS_ABERTO.has(s) && !STATUS_COLETADO.has(s) &&
      !STATUS_FECHADO_SEM_COLETA.has(s) && s !== STATUS_AGENDADO;
  }

  // dd/mm/yyyy (the report's format) -> yyyy-mm-dd, for comparing against
  // an ISO today. Returns '' for anything else, including an empty cell —
  // which is the common case, since a "Não iniciado" household has no
  // dates at all.
  function isoDeDataBr(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }

  // dd/mm/yyyy[ HH:MM[:SS]] -> a "yyyy-mm-dd HH:MM:SS" sort key for
  // DataTables' data-order. Unlike isoDeDataBr it keeps the time, so
  // same-day rows still order chronologically. '' for a blank or
  // unparseable cell — a dateless row groups with the other dateless
  // rows instead of pretending to be a moment in time.
  function chaveOrdenavelDataBr(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})(\s+\d{2}:\d{2}(?::\d{2})?)?/
      .exec(String(s || '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? ` ${m[4].trim()}` : ''}` : '';
  }

  // 'Agendado' is the one conditional status: it closes the household
  // only while the booked date has not passed. A booking that lapsed
  // without a collection is demand again — otherwise a visit missed in
  // March would still read as "on its way" in August.
  function coletaEmAberto(r, hojeIso) {
    const s = (r && r.status) || '';
    if (STATUS_ABERTO.has(s)) return true;
    if (s !== STATUS_AGENDADO) return false;
    const hoje = hojeIso || new Date().toISOString().slice(0, 10);
    const marcada = isoDeDataBr(r && r.dataAgendada);
    // No date on an 'Agendado' row: treat as still booked rather than
    // inventing demand from a missing cell.
    return marcada ? marcada < hoje : false;
  }

  // The operative demand: the interview came through AND the collection
  // is still open. pns.zonas' `realizadas_sem_agendamento`
  // (relatorio_agenda.R:345) — `entrevista_feita & coleta_em_aberto`,
  // unbooked.
  //
  // The broader column (pendentes) drops the interview requirement and
  // asks only that the household be in the field with its collection
  // open, so the narrow measure is nested inside it by construction —
  // exactly the relation isRealizadaSemAgendamento ⊂ isPendente has on
  // the Último Movimento side, and what the header tooltip promises.
  //
  // "Unbooked" is not tested separately: coletaEmAberto already returns
  // false for a live 'Agendado' and true once its date has lapsed, so a
  // stale Data Agendada can neither hide demand nor invent it.
  function deveColeta(r, hojeIso) {
    return coletaEmAberto(r, hojeIso) && (r && r.tipoEntrevista) === 'Realizada';
  }

  // --- Prazo final da coleta -------------------------------------------
  //
  // Days until the collection deadline, RECOMPUTED from data_final_coleta
  // rather than read from the report's `Dias Prazo Final`.
  //
  // SIGC truncates that field at zero: a household three weeks overdue
  // reports 0, exactly like one due today. Sorting or filtering by it puts
  // the most urgent work nowhere near the top. Here overdue goes negative,
  // which is what makes it sortable. (On the BA snapshot, 40 of 253 rows
  // disagreed with the recomputed value; 39 of them by truncation.)
  //
  // null — not zero — when there is no deadline: ~86% of households have
  // none, because it is born from the 25A.01 answer, and "no deadline" is
  // not "due today".
  const MS_POR_DIA = 86400000;

  function diasParaPrazo(r, hojeIso) {
    const iso = isoDeDataBr(r && r.dataFinalColeta);
    if (!iso) return null;
    const hoje = hojeIso || new Date().toISOString().slice(0, 10);
    return Math.round(
      (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / MS_POR_DIA);
  }

  // Within this many days of the deadline (or already past it) is worth
  // flagging. pns.zonas' PRAZO_ALERTA (relatorio_agenda.R:521).
  const PRAZO_ALERTA = 10;

  // Needs action before the deadline closes.
  //
  // The collected check is not redundant with the open-collection one: a
  // collected household KEEPS its deadline, so "prazo < 10 dias" alone
  // flags finished work. That was the R's first version, and 75 of its 138
  // highlights were already collected, 24 refused — highlighting finished
  // work is worse than highlighting nothing.
  //
  // 'Recusa' is included by exception. It is a closed status, so
  // coletaEmAberto excludes it, but reverting a refusal is exactly the
  // work the running clock threatens. 'Outro Motivo' and 'Não elegível'
  // are not: there is nothing to revert.
  function emAlertaDePrazo(r, hojeIso) {
    const s = (r && r.status) || '';
    if (STATUS_COLETADO.has(s)) return false;
    const dias = diasParaPrazo(r, hojeIso);
    if (dias === null) return false;
    if (!coletaEmAberto(r, hojeIso) && s !== 'Recusa') return false;
    return dias < PRAZO_ALERTA;
  }

  // What to actually DO, which is not the same for every alerted
  // household. Agendar and reagendar are agenda work; reverting a refusal
  // is persuasion and supervision, and no free slot resolves it.
  //
  // Without this split, 24 of BA's 39 alerted rows were refusals, and the
  // genuinely bookable households were a minority in their own list.
  function acaoDePrazo(r, hojeIso) {
    const s = (r && r.status) || '';
    if (s === 'Recusa') return 'reverter recusa';
    if (s === STATUS_AGENDADO) return 'reagendar';
    if (s === 'A agendar') return 'agendar';
    if (s === 'Indefinido') return 'definir situação';
    return 'verificar';
  }

  function agendavelDePrazo(r) {
    return ((r && r.status) || '') !== 'Recusa';
  }

  // The Relatório de Acompanhamento de Biomarcadores, where the map is
  // moving to (docs/mapa-biomarcadores.md). Unlike Último Movimento this
  // page has no <h6> report title — the live capture (2026-08-14) names
  // it only in the breadcrumb's active crumb — so onUltimoMovimento()'s
  // h6 probe finds nothing here and the two detectors can't be shared.
  //
  // Matches the FULL report name, never the bare word "Biomarcadores":
  // that word is the breadcrumb's first crumb and a menu entry across
  // SIGC, so matching it would mount this feature on unrelated pages.
  // Both the breadcrumb and an h6 are searched, so a future SIGC redesign
  // that adds a title (or drops the breadcrumb) doesn't silently kill the
  // feature — the same lesson onUltimoMovimento's own comment records.
  const NOME_RELATORIO_BIOMARCADORES = 'acompanhamento de biomarcadores';

  function onBiomarcadores() {
    const AM = window.__sigcProAgendaLookups;
    const sel = 'h6, .breadcrumb-item, [aria-current="page"]';
    return [...document.querySelectorAll(sel)].some((el) => window.__sigcPro
      .normalizeLabel(AM.stripAccents(el.textContent))
      .includes(NOME_RELATORIO_BIOMARCADORES));
  }

  // Which variant this page gets. Biomarcadores is checked first: it is
  // the specific page, and its breadcrumb could in principle coexist with
  // an Último Movimento string somewhere in a shared chrome.
  function modoAtual() {
    return onBiomarcadores() ? MODO_BIOMARCADORES : MODO_MOVIMENTO;
  }

  // A slot needs lead time to be filled: the lab has to be arranged and
  // the household contacted, so today and the next two days are already
  // spoken for. On a FRIDAY the third day is out too — it lands on Monday,
  // and the weekend is not working time to arrange anything in.
  //
  // Ports pns.zonas' primeiro_dia_agendavel() (R/sigc_biomarcadores.R:442)
  // exactly, including the Friday case. Counting the dead head as capacity
  // is how a zona looks able to absorb its demand when the bookable slots
  // are already gone: in BA, applying this floor took the zonas with a
  // negative gap from 6 to 9.
  //
  // Note this is the only place the weekend matters. It is lead TIME, not
  // a filter on which slots count: SIGC has no weekend slots today, but
  // nothing forbids them, and a Saturday slot three weeks out is real
  // capacity. Excluding it would understate the zona — the opposite of the
  // bug this fixes.
  //
  // Dates are handled as ISO strings via UTC to match every other date in
  // this file (todayIso and the report's own columns), where a local-time
  // Date would shift the day across the timezone boundary.
  const SEXTA = 5; // getUTCDay(): 0=domingo … 5=sexta

  function isoMaisDias(isoDate, dias) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  function primeiroDiaAgendavel(hojeIso) {
    const dow = new Date(`${hojeIso}T00:00:00Z`).getUTCDay();
    return isoMaisDias(hojeIso, dow === SEXTA ? 4 : 3);
  }

  // 17 calendar days from TODAY, not from the first bookable day — the
  // dead head deliberately eats into it (relatorio_agenda.R:86-92). The
  // window is "the short term", not "the next N bookable days", so what
  // is left is ~two weeks of fillable slots.
  const JANELA_DIAS = 17;

  function fimDaJanela(hojeIso) {
    return isoMaisDias(hojeIso, JANELA_DIAS);
  }

  // The zona owes more biomarcador visits than it has bookable slots in
  // the window — pns.zonas' relatorio_agenda.R `capacidade_ok`, with the
  // tighter numerator (see isRealizadaSemAgendamento).
  //
  // Compared against manhã+tarde rather than against the day-by-day list
  // so both come from indexZonaLivres' single selection — deriving the
  // flag from a different count than the columns show is how a table
  // ends up contradicting itself.
  //
  // A zona owing nothing never flags, however few slots it has: zero
  // demand needs zero capacity. Only a shortfall against real, committed
  // demand is worth a supervisor's attention.
  // Compared against "A agendar", which is the number the table shows —
  // aAgendar on the biomarcadores page, the proxy count on Último
  // Movimento. Flagging from a count the reader cannot see is how a row
  // ends up highlighted while its own numbers say otherwise.
  function zonaSemCapacidade(r, turnos) {
    const owed = r.aAgendar != null ? r.aAgendar : (r.realizadasSemAgendamento || 0);
    if (owed === 0) return false;
    const t = turnos || {};
    return owed > (t.manha || 0) + (t.tarde || 0);
  }

  // Column tooltips shared by the Zonas/Controles table AND the
  // Entrevistadores table — the two show the same classification
  // columns, and a tooltip that drifted between them would explain the
  // same number two different ways. Zona-only tooltips (déficit, turnos,
  // pin) stay inside buildZonasTableHtml.
  const TIP_RECUSA =
    'Recusa da ENTREVISTA, não do biomarcador — quem recusa o ' +
    'biomarcador costuma constar aqui como entrevista realizada.';
  const TIP_NAO_DISTRIBUIDA =
    'Domicílio selecionado que não aparece no relatório (o Último ' +
    'Movimento cobre tudo que saiu da base) ou com Última Posição ' +
    '"Não Distribuído": o questionário ainda não foi distribuído. As ' +
    'demais colunas seguem o Tipo Entrevista do relatório.';
  // "Não Iniciada" is SIGC's word for "no outcome transmitted", not a
  // literal "untouched": measured against biomarcadores in BA, every
  // blank-outcome household carries it, including partially-unloaded
  // interviews and a few with a coleta already booked.
  const TIP_NAO_INICIADA =
    'Tipo Entrevista "Não Iniciada": nenhum desfecho de entrevista ' +
    'transmitido — pode não ter começado, estar no meio do caminho ou ' +
    'ter terminado sem descarregar por completo.';
  const TIP_A_ENTREVISTAR =
    'A entrevista ainda não aconteceu (Última Posição "Não Distribuído", ' +
    '"Distribuido" ou "Enviado para Carga") — não é atraso de coleta.';
  // NOT "em andamento": the SIGC recorded no tipo at all, so there is
  // no evidence the interview progressed — only that the household
  // left distribution. An interview genuinely under way shows a tipo
  // and lands in one of the columns to the right.
  const TIP_EM_ANDAMENTO =
    'Já saiu da distribuição, mas o SIGC não registrou tipo de ' +
    'entrevista — situação indefinida. Não afirma que a entrevista começou.';
  const TIP_SEM_AGENDAMENTO =
    'Entrevista realizada, mas o agendamento do biomarcador nunca foi ' +
    'aberto (item 25A.01 não respondido). Não há prazo correndo.';
  const TIP_AGEND_PENDENTE =
    'Prazo do biomarcador correndo e sem horário marcado — inclui ' +
    'agendamento vencido. É a fila de trabalho da zona.';
  const TIP_AGENDADO = 'Biomarcador com data futura marcada.';
  const TIP_COLETADO = 'Biomarcador coletado (sangue, urina ou ambos).';
  const TIP_RECUSA_BIO =
    'Recusou a COLETA de sangue/urina. A entrevista costuma ter sido ' +
    'realizada. Reverter exige convencer sobre o exame.';
  const TIP_RECUSA_ENTREV =
    'Recusou a ENTREVISTA — não se chegou à coleta. Reverter exige ' +
    'convencer sobre a pesquisa inteira. Quem recusou as duas conta em ' +
    'Recusa biomarc.';
  const TIP_INELEGIVEL =
    'Entrevista concluída e descarregada sem abrir o biomarcador. ' +
    'Morador selecionado com menos de 35 anos ou outra inelegibilidade ' +
    '— não haverá coleta.';
  const TIP_VENCIDOS =
    'Quantos dos "Agendamento pendente" já passaram do prazo. Contidos ' +
    'naquela coluna — não somar as duas.';
  const TIP_SEM_ENTREVISTA =
    'Sem entrevista aproveitável: domicílio vago, uso ocasional, ' +
    'demolido, fora de âmbito ou encerrado por outro motivo.';

  // The classification/tipo columns each variant shows, one list per
  // variant, shared by the Zonas/Controles and Entrevistadores tables so
  // their headers and cells can never drift apart. [label, tip, campo,
  // extraTdClass].
  const COLUNAS_CONTAGEM_BIO = [
    ['A entrevistar', TIP_A_ENTREVISTAR, 'aEntrevistar', ''],
    ['Em campo (indefinida)', TIP_EM_ANDAMENTO, 'emAndamento', ''],
    ['Sem agendamento iniciado', TIP_SEM_AGENDAMENTO, 'semAgendamento', ''],
    ['Agendamento pendente', TIP_AGEND_PENDENTE, 'agendamentoPendente', 'sigc-pro-devidas'],
    ['Vencidos', TIP_VENCIDOS, 'vencidos', ''],
    ['Agendado', TIP_AGENDADO, 'agendadoBio', ''],
    ['Coletado', TIP_COLETADO, 'coletado', ''],
    ['Recusa biomarc.', TIP_RECUSA_BIO, 'recusaBiomarcador', ''],
    ['Recusa entrev.', TIP_RECUSA_ENTREV, 'recusaEntrevista', ''],
    ['Inelegível', TIP_INELEGIVEL, 'inelegivel', ''],
    ['Encerrado sem entrevista', TIP_SEM_ENTREVISTA, 'semEntrevista', ''],
  ];
  const COLUNAS_CONTAGEM_MOV = [
    ['Não distribuída', TIP_NAO_DISTRIBUIDA, 'naoDistribuida', ''],
    ['Realizada', '', 'realizada', ''],
    ['Não Iniciada', TIP_NAO_INICIADA, 'naoIniciada', ''],
    ['Dom. Fechado', '', 'domicilioFechado', ''],
    ['Recusa entrev.', TIP_RECUSA, 'recusa', ''],
    ['Outros', '', 'outros', ''],
  ];

  // slotsPorZona: Map(idZona -> [{isoDate, horas}]) already grouped by
  // agruparPorDia — see the window today..+2 weeks computation at the
  // onMapaClick call site. Rendered in its own cell via <details>, kept
  // deliberately apart from the Zona name cell's <a>: that click already
  // does something else (focus the map on this zona, wireZonaRowClicks),
  // and a <details> nested inside it would either steal that gesture or
  // silently do nothing when clicked.
  // turnosPorZona: Map(idZona -> {manha, tarde, ...}) from
  // agenda-lookups' indexZonaLivres — the SAME selection the day-by-day
  // slots cell is built from, so the turno columns and the list under
  // them can never disagree.
  // modo defaults to MODO_BIOMARCADORES (the full table) so existing
  // callers keep every column.
  function buildZonasTableHtml(zonaRows, slotsPorZona, turnosPorZona, modo) {
    const m = modo || MODO_BIOMARCADORES;
    const esc = window.__sigcPro.escapeHtml;
    const AM = window.__sigcProAgendaLookups;
    const slotsMap = slotsPorZona || new Map();
    const turnosMap = turnosPorZona || new Map();
    // "Recusa" is two different outcomes in SIGC, in nearly disjoint
    // populations: refusing the INTERVIEW (tipoEntrevista, what this
    // report shows) and refusing the biomarcador COLLECTION (the
    // biomarcadores report's status). In BA ~50 households refused the
    // collection against 18 who refused the interview — and almost every
    // collection refusal appears HERE as a successful interview, because
    // it was one. Naming the column plain "Recusa" invites a reader to
    // take it for the collection refusal it structurally cannot show.
    // One per turno: the shared text ended with "Manhã antes das 13h",
    // which read as a definition of the column it was hovering over — so
    // "Slots tarde" explained the morning cut-off and said nothing about
    // the afternoon.
    const TIP_JANELA =
      'Slots livres do primeiro dia ainda agendável (hoje+3, ou hoje+4 na ' +
      'sexta) até +17 dias.';
    const TIP_TURNO_MANHA = `${TIP_JANELA} Manhã: antes das 13h.`;
    const TIP_TURNO_TARDE = `${TIP_JANELA} Tarde: a partir das 13h.`;
    // Pin column, deliberately first and narrow. The click used to live on
    // the whole <tr>, which made the table hostile to ordinary use:
    // selecting a Controle to copy it fired the handler, switched tabs and
    // pulled the table out from under the cursor (reported against the R
    // twin, same layout). Confining the gesture to one glyph also makes
    // what is clickable visible at rest, and frees the row for a <details>
    // that the row handler used to swallow.
    //
    // data-orderable="false" is declared on the header itself rather than
    // through a positional columnDefs entry: initPanelTables uses no
    // column indices at all (order: []), so nothing else has to be
    // renumbered when a column is added — which is exactly the trap a
    // positional config would have set here.
    const TIP_DEFICIT =
      'Agendamento pendente menos os slots livres da janela. Positivo: a ' +
      'zona deve mais coletas do que consegue marcar.';
    const TIP_A_AGENDAR =
      'Entrevista realizada, biomarcador em aberto e sem horário marcado — ' +
      'inclui agendamento vencido sem coleta. Só entra quem dá para agendar ' +
      'hoje: sem entrevista feita não há coleta a marcar.';
    const TIP_JA_AGENDADOS =
      'Entrevista realizada e biomarcador com data futura marcada. Somado a ' +
      '"A agendar" dá a carga agendável da zona.';
    const g = grupoDe(m);
    const TIP_PIN = `Ver ${g.campo === 'controle' ? 'este controle' : 'esta zona'} no mapa`;
    // Header and body segments are gated by the SAME flags, so a column
    // can never appear in one and not the other — the failure mode that
    // silently shifts every later cell into the wrong column.
    //
    // The nome rides inside the Zona cell (same markup the Domicílios
    // tab uses) rather than in its own column, and there is no Sem
    // coordenadas column — that count is housekeeping about the map,
    // almost always 0, and lives in the zona/controle popup instead.
    // Left to right IS the pipeline, with the two dead ends pulled out
    // of it (see classificaDomicilio) — the order is the descriptors'.
    const colunas = m.comDemanda ? COLUNAS_CONTAGEM_BIO : COLUNAS_CONTAGEM_MOV;
    const contagemHead = colunas.map(([label, tip]) =>
      `<th${tip ? ` title="${esc(tip)}"` : ''}>${esc(label)}</th>`).join('');
    const head =
      '<tr>' +
      `<th class="sigc-pro-zona-pin-col" data-orderable="false" title="${esc(TIP_PIN)}"></th>` +
      `<th>${esc(g.rotulo)}</th>` +
      contagemHead +
      (m.comDemanda ? `<th title="${esc(TIP_DEFICIT)}">Déficit</th>` : '') +
      '<th>Total</th>' +
      (m.comSlots
        ? `<th title="${esc(TIP_TURNO_MANHA)}">Slots manhã</th>` +
          `<th title="${esc(TIP_TURNO_TARDE)}">Slots tarde</th>` +
          '<th>Slots livres</th>'
        : '') +
      '</tr>';
    // Worst deficit first. Sorted HERE rather than through DataTables'
    // `order` so the CSV export carries the same order the reader saw —
    // and so the amber rows are at the top instead of scattered below
    // the fold, which made the tab's own alert fight its layout.
    const ordenadas = m.comDemanda
      ? [...zonaRows].sort((a, b) => {
        const falta = (z) => (z.agendamentoPendente || 0) -
          ((turnosMap.get(z.idZona || '') || {}).manha || 0) -
          ((turnosMap.get(z.idZona || '') || {}).tarde || 0);
        return falta(b) - falta(a) ||
          (b.agendamentoPendente || 0) - (a.agendamentoPendente || 0) ||
          String(a.idZona || '').localeCompare(String(b.idZona || ''));
      })
      // No deficit to rank by on this variant, so order by the id itself.
      // The alternative is insertion order — endereços first, then the
      // report — which is arbitrary from the reader's side and changes
      // between runs as the address list does. A Controle sorts
      // meaningfully: its digits are UF, município and setor, so
      // ascending order groups the map's neighbours together.
      : [...zonaRows].sort((a, b) => String(a.idZona || '')
        .localeCompare(String(b.idZona || '')));
    const body = ordenadas.map((r) => {
      const clickable = zonaRowIsClickable(r);
      const zonaKey = r.idZona || '';
      const turnos = turnosMap.get(zonaKey) || { manha: 0, tarde: 0 };
      // The flag compares demand against free slots; without the agenda
      // there is neither, so it must not fire — a shortfall painted from
      // absent data reads as "0 slots free" when the truth is "not asked".
      const semCapacidade = m.comSlots && zonaSemCapacidade(r, turnos);
      // Same subtraction the amber row title spells out, promoted to a
      // column so it can be sorted and compared across zonas.
      const deficit = (r.agendamentoPendente != null ? r.agendamentoPendente : 0) -
        ((turnos.manha || 0) + (turnos.tarde || 0));
      const classes = [
        clickable ? 'sigc-pro-zona-row-clickable' : '',
        semCapacidade ? 'sigc-pro-zona-sem-capacidade' : '',
      ].filter(Boolean).join(' ');
      // Only the shortfall explanation: the row is no longer a click
      // target, so telling the user to click it pointed at a gesture that
      // does nothing. The pin carries its own tooltip.
      const titulo = semCapacidade
        ? `Deve ${r.aAgendar != null ? r.aAgendar : r.realizadasSemAgendamento} biomarcador(es) e tem ` +
          `${turnos.manha + turnos.tarde} slot(s) livre(s) na janela`
        : '';
      // No data-id-zona on the <tr> any more — the pin owns the gesture.
      const rowAttrs =
        (classes ? ` class="${classes}"` : '') +
        (titulo ? ` title="${esc(titulo)}"` : '');
      // Plain text now: with the pin carrying the affordance, a link on
      // the zona code would be a second, competing click target over text
      // the user most likely wants to select and copy. Id plus nome in
      // one cell, exactly as the Domicílios tab renders its Zona column.
      const nomeDiferente = g.temNome && r.nomeZona && r.nomeZona !== r.idZona;
      const zonaLabel = nomeDiferente
        ? `${esc(r.idZona)} <span class="sigc-pro-zona-nome">${esc(r.nomeZona)}</span>`
        : esc(r.idZona || '—');
      const pinCell = clickable
        ? '<span class="sigc-pro-zona-pin" role="button" tabindex="0" ' +
          `data-id-zona="${esc(zonaKey)}" title="${esc(TIP_PIN)}" ` +
          `aria-label="${esc(`${TIP_PIN}: ${r.idZona || ''}`)}">📍</span>`
        : '';
      // Rendered inline, NOT behind a <details>: the whole row is a click
      // target that jumps to the map, so a disclosure widget inside it was
      // unopenable — the row handler swallowed the summary's click and
      // switched tabs instead (reported 2026-08-12).
      const grupos = slotsMap.get(zonaKey) || [];
      const slotsCell = AM.buildSlotsLivresHtml(grupos);
      // Sorting a block of day/hour markup as text is meaningless; the
      // useful order is "which zona has the most capacity left", so the
      // sort key is the total number of open slots.
      const slotsCount = grupos.reduce((n, g) => n + ((g.horas && g.horas.length) || 0), 0);
      // The count cells come from the same descriptors as the header —
      // a column can never appear in one and not the other. The
      // 'sigc-pro-devidas' class bolds the actionable queue: the one
      // number in the row that says "book something this week".
      const contagemCells = colunas.map(([, , campo, cls]) =>
        `<td${cls ? ` class="${cls}"` : ''}>${r[campo] || 0}</td>`).join('');
      return (
        `<tr${rowAttrs}>` +
        `<td class="sigc-pro-zona-pin-col">${pinCell}</td>` +
        `<td>${zonaLabel}</td>` +
        contagemCells +
        (m.comDemanda
          // The manager's actual question, as a sortable number rather
          // than a hover title: how many bookings does this zona owe
          // beyond what its free slots can absorb.
          ? `<td class="${deficit > 0 ? 'sigc-pro-devidas' : ''}" data-order="${deficit}">` +
            `${deficit > 0 ? deficit : '—'}</td>`
          : '') +
        `<td>${r.totalDomicilios}</td>` +
        (m.comSlots
          ? `<td>${turnos.manha || 0}</td><td>${turnos.tarde || 0}</td>` +
            `<td class="sigc-pro-slots-cell" data-order="${slotsCount}">${slotsCell}</td>`
          : '') +
        '</tr>'
      );
    }).join('');
    return `<table class="sigc-pro-zonas-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // The Entrevistadores tab: the same classification counts the
  // Zonas/Controles tab shows (same descriptors, so the two can never
  // disagree on labels or tooltips), bucketed by the report's own
  // Entrevistador column, plus the areas each person has households in.
  // Leaner on purpose: no pin (an entrevistador has no hull to jump to),
  // no slots/déficit/capacidade (capacity belongs to a zona, not a
  // person). Rows sorted by Total desc — the most-loaded person first —
  // with "Sem entrevistador" always last.
  const TIP_AREAS =
    'Onde estão os domicílios deste entrevistador — a mesma unidade da ' +
    'outra aba. Ordena pela quantidade de áreas.';
  function buildEntrevistadoresTableHtml(rows, modo) {
    const m = modo || MODO_BIOMARCADORES;
    const esc = window.__sigcPro.escapeHtml;
    const colunas = m.comDemanda ? COLUNAS_CONTAGEM_BIO : COLUNAS_CONTAGEM_MOV;
    const areaLabel = m.comDemanda ? 'Zonas' : 'Controles';
    const head = '<tr><th>Entrevistador</th>' +
      colunas.map(([label, tip]) =>
        `<th${tip ? ` title="${esc(tip)}"` : ''}>${esc(label)}</th>`).join('') +
      '<th>Total</th>' +
      `<th title="${esc(TIP_AREAS)}">${areaLabel}</th></tr>`;
    const semGrupo = GRUPO_ENTREVISTADOR.semGrupoLabel;
    const ordenadas = [...(rows || [])].sort((a, b) => {
      const aSem = a.nomeZona === semGrupo, bSem = b.nomeZona === semGrupo;
      if (aSem !== bSem) return aSem ? 1 : -1;
      return (b.totalDomicilios || 0) - (a.totalDomicilios || 0) ||
        String(a.nomeZona || '').localeCompare(String(b.nomeZona || ''));
    });
    const body = ordenadas.map((r) => {
      const areas = [...(r.grupos || [])].sort();
      const cells = colunas.map(([, , campo, cls]) =>
        `<td${cls ? ` class="${cls}"` : ''}>${r[campo] || 0}</td>`).join('');
      return '<tr>' +
        `<td>${esc(r.nomeZona || r.idZona || semGrupo)}</td>` +
        cells +
        `<td>${r.totalDomicilios}</td>` +
        `<td class="sigc-pro-areas-cell" data-order="${areas.length}">${esc(areas.join(' '))}</td>` +
        '</tr>';
    }).join('');
    return `<table class="sigc-pro-zonas-table sigc-pro-entrevistadores-table">` +
      `<thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // Household row columns: Controle+Domicílio, Agendado, Situação
  // (ultimaPosicao), Tipo (tipoEntrevista), Entrevistador, Data. There is
  // no street-address field on this row shape (see joinEnderecos/
  // joinAgenda) — the endereços map carries only {lat, lon, zona,
  // idZona}, no address — so Controle+Domicílio stands in as the row
  // identifier instead.
  function buildDomiciliosTabHtml(rows, modo, hojeIso, slotsPorZona) {
    const m = modo || MODO_BIOMARCADORES;
    const AM = window.__sigcProAgendaLookups;
    const slotsMap = slotsPorZona || new Map();
    const hoje = hojeIso || new Date().toISOString().slice(0, 10);
    const esc = window.__sigcPro.escapeHtml;
    const dash = (v) => (v ? esc(v) : '—');
    const TIP_PRAZO =
      'Dias até o prazo final do biomarcador, recalculado — negativo quando ' +
      'vencido. O campo do SIGC trunca em zero e não distingue "vence hoje" ' +
      'de "venceu há três semanas".';
    const TIP_ACAO =
      'O próximo passo deste domicílio. Agendar e reagendar são trabalho ' +
      'de agenda; reverter recusa é convencimento, e nenhum slot resolve.';
    const TIP_PIN_DOM = 'Ver este domicílio no mapa';
    const TIP_SITUACAO =
      'Mesma classificação das colunas da aba Zonas — cada domicílio está ' +
      'em exatamente uma situação.';
    const TIP_AMOSTRAS = 'Situação de cada amostra: sangue / urina.';
    const TIP_SLOTS_DOM =
      'Slots livres da zona deste domicílio, na janela agendável. Só ' +
      'aparece em quem ainda precisa de horário.';
    // Same header/body gating contract as buildZonasTableHtml: an
    // "Agendado" column of em-dashes would read as "nothing scheduled"
    // when no agenda was ever requested.
    //
    // "Situação" carries ultimaPosicao on Último Movimento and the
    // biomarcador status on the other page — the same question ("where
    // does this household stand?") answered from each report's own field.
    // On the biomarcadores page the row answers "what is this household's
    // collection state and what do I do about it" — so Situação carries
    // the same nine-way vocabulary the Zonas columns use, and the people
    // and dates are the collection's, not Último Movimento's.
    // Pin first, same contract as the Zonas table: narrow, unsortable,
    // and excluded from the CSV (sigc-pro-zona-pin-col is what
    // tabelaParaCsv drops). Without it the household table had no way to
    // the map — you could find a domicílio here and still not locate it.
    const pinTh =
      `<th class="sigc-pro-zona-pin-col" data-orderable="false" title="${esc(TIP_PIN_DOM)}"></th>`;
    const head = m.comDemanda
      ? `<tr>${pinTh}<th>Controle</th><th>Domicílio</th><th>Agência</th><th>Zona</th>` +
        `<th title="${esc(TIP_SITUACAO)}">Situação</th>` +
        `<th title="${esc(TIP_ACAO)}">Ação</th>` +
        `<th title="${esc(TIP_PRAZO)}">Prazo</th>` +
        '<th>Agendado</th><th>Coleta</th>' +
        `<th title="${esc(TIP_AMOSTRAS)}">Amostras</th>` +
        '<th>Equipe</th><th>SIAPE</th>' +
        // The zona's free slots, repeated on the household row: deciding
        // whether this one can be fitted used to mean noting the zona,
        // switching to the Zonas tab, finding the row and switching back
        // — once per call. Same listing, same source, no extra request.
        `<th title="${esc(TIP_SLOTS_DOM)}">Slots livres</th></tr>`
      // No Zona column: this variant groups by Controle, which already
      // has its own column two to the left. Keeping zona here would show
      // a grouping the tab, the map and the CSV no longer use.
      : `<tr>${pinTh}<th>Controle</th><th>Domicílio</th>` +
        (m.comAgenda ? '<th>Agendado</th>' : '') +
        '<th>Situação</th><th>Tipo</th>' +
        '<th>Entrevistador</th><th>Data</th></tr>';
    const body = (rows || []).map((r) => {
      // data-order: the raw ISO timestamp, so DataTables sorts this column
      // chronologically instead of lexicographically on "dd/mm/yyyy HH:MM"
      // (which would put every 01/… together regardless of month or year).
      // Unscheduled rows sort last under either direction via the empty key.
      const agendadoCell = r.agendado
        ? `<span class="${r.futura ? 'sigc-pro-futura' : 'sigc-pro-passada'}">${esc(r.agendado)}</span>`
        : '—';
      const agendadoSort = esc(r.agendadoOrdenavel || '');
      // Sorted by the recomputed day count, so overdue rows (negative)
      // lead an ascending sort. A household with no deadline gets an empty
      // key and sorts last either way — it is not "due today".
      // Only while the deadline still means something. A finished
      // household keeps its prazo in the data, and printing "Vencido"
      // for work that is DONE reads as a missed deadline — the clock
      // stopped when the collection did.
      //
      // 'Recusa' keeps it, for the same reason it still alerts (see
      // emAlertaDePrazo): reverting a refusal is work the clock threatens.
      const precisaSlot = m.comDemanda &&
        classificaDomicilio(r, hoje) === 'agendamentoPendente';
      const prazoRelevante = m.comDemanda &&
        (coletaEmAberto(r, hoje) || (r && r.status) === 'Recusa');
      const dias = prazoRelevante ? diasParaPrazo(r, hoje) : null;
      const alerta = m.comDemanda && emAlertaDePrazo(r, hoje);
      // sigc-pro-prazo-cell marks this cell as "export the sort key, not
      // the text" — see celulaParaTexto, which needs the bare number so a
      // spreadsheet can still sort the overdue rows.
      //
      // The dash cell carries a numeric key too: ONE keyless cell made
      // DataTables type the whole column as text, so "-21" sorted after
      // "5" lexicographically. 9999 rather than 0 — a household with no
      // deadline is not "due today"; ascending (the useful direction:
      // overdue first) puts it after every real deadline.
      const prazoCell = dias === null
        ? '<td data-order="9999">—</td>'
        : `<td class="sigc-pro-prazo-cell${alerta ? ' sigc-pro-prazo-alerta' : ''}"` +
          ` data-order="${dias}">` +
          // The number rides INSIDE the cell, hidden. DataTables hands
          // the exporter a cell's inner HTML without its attributes, so
          // data-order is unreachable for any row not currently rendered
          // — an off-page overdue row would export the word "Vencido"
          // into a column of day counts. Carried this way, every row
          // exports numerically whether it was on screen or not.
          `<span class="sigc-pro-prazo-num${dias < 0 ? ' sigc-pro-prazo-num-oculto' : ''}">` +
          `${dias}</span>${dias < 0 ? 'Vencido' : ''}</td>`;
      // Only where there is somewhere to go: a household without
      // coordinates would give a click that silently does nothing.
      const pinDom = r.temCoordenadas
        ? '<span class="sigc-pro-zona-pin sigc-pro-dom-pin" role="button" tabindex="0"' +
          ` data-dom-key="${esc(`${r.controle}|${r.domicilio}`)}"` +
          ` title="${esc(TIP_PIN_DOM)}"` +
          ` aria-label="${esc(`${TIP_PIN_DOM}: ${r.controle}/${r.domicilio}`)}">📍</span>`
        : '';
      return (
        `<tr${alerta ? ' class="sigc-pro-prazo-alerta-row"' : ''}>` +
        `<td class="sigc-pro-zona-pin-col">${pinDom}</td>` +
        `<td>${dash(r.controle)}</td>` +
        `<td>${dash(r.domicilio)}</td>` +
        // Id plus name on the biomarcadores page: the row is read one at
        // a time there, and "29XJYY" alone does not say where that is.
        // Último Movimento keeps the bare id — its column exists to tell
        // rows apart and to sort/filter, which the short id does in far
        // less width.
        (m.comDemanda ? `<td>${dash(r.agencia)}</td>` : '') +
        (m.comDemanda
          ? `<td>${r.zona
            ? `${esc(r.idZona)} <span class="sigc-pro-zona-nome">${esc(r.zona)}</span>`
            : dash(r.idZona)}</td>`
          : '') +
        (m.comDemanda
          ? `<td>${dash(CLASSE_LABEL[classificaDomicilio(r, hoje)])}</td>` +
            `<td>${dash(acaoDoDomicilio(r, hoje))}</td>` +
            prazoCell +
            `<td data-order="${agendadoSort}">${agendadoCell}</td>` +
            // Sortable like Agendado: the report prints dd/mm/yyyy, which
            // orders by DAY when sorted as text — every 01/… together
            // regardless of month or year.
            `<td data-order="${esc(chaveOrdenavelDataBr(r.dataVisita))}">${dash(r.dataVisita)}</td>` +
            // Sangue / urina side by side: "Coletado apenas Sangue" says
            // one was missed, but not which follow-up the other needs.
            `<td>${dash([r.statusSangue, r.statusUrina].filter(Boolean).join(' / '))}</td>` +
            `<td>${dash(r.nomeEquipe)}</td>` +
            `<td>${dash(r.siapeColeta || r.siapeAgendamento)}</td>` +
            // Only where a booking is the next step: a collected or
            // terminal household needs no slot, and repeating the zona's
            // whole agenda on its row is noise in a row-by-row read.
            `<td class="sigc-pro-slots-cell">${
              precisaSlot ? AM.buildSlotsLivresHtml(slotsMap.get(r.idZona || '') || []) : '—'
            }</td>`
          : (m.comAgenda ? `<td data-order="${agendadoSort}">${agendadoCell}</td>` : '') +
            `<td>${dash(r.ultimaPosicao)}</td>` +
            `<td>${dash(r.tipoEntrevista)}</td>` +
            `<td>${dash(r.entrevistador)}</td>` +
            // Same sortable treatment as the biomarcadores dates: the
            // Data column carries "dd/mm/yyyy HH:MM:SS".
            `<td data-order="${esc(chaveOrdenavelDataBr(r.data))}">${dash(r.data)}</td>`) +
        '</tr>'
      );
    }).join('');
    return `<table class="sigc-pro-domicilios-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // Names the report each variant was built from. The movimento caveat
  // ("this page cannot tell who still owes a biomarcador") lives in the
  // tooltip and the Entenda tab, not in the label — a parenthetical
  // there read as a subtitle, not a warning.
  const FONTE_LABEL = {
    biomarcadores: 'Biomarcadores',
    movimento: 'Último Movimento',
  };
  const FONTE_TIP = {
    biomarcadores:
      'Dados do Relatório de Acompanhamento de Biomarcadores: a situação de ' +
      'cada domicílio vem do status informado pelo SIGC.',
    movimento:
      'Dados do Último Movimento, que não informa a situação do biomarcador. ' +
      'Sem consulta à agenda: sem agendamentos, slots livres nem demanda. ' +
      'Para isso, abra o Relatório de Acompanhamento de Biomarcadores.',
  };

  const BUTTON_ID = 'sigc-pro-ultimo-movimento-map-btn';
  const PANEL_ID = 'sigc-pro-ultimo-movimento-map-panel';

  const PANEL_CSS = `
    #${PANEL_ID} { position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; }
    #${PANEL_ID} .sigc-pro-panel-box { background: #fff; width: 90vw; height: 85vh;
      border-radius: 6px; display: flex; flex-direction: column; overflow: hidden;
      font-family: system-ui, sans-serif; font-size: 13px; }
    #${PANEL_ID} .sigc-pro-panel-bar { display: flex; gap: 4px; background: #f4f4f4;
      border-bottom: 1px solid #ccc; padding: 4px; align-items: center; }
    /* Source label: reads as a caption, not as a tab — it is the one item
       in this bar that is not clickable, so it must not look like one. */
    #${PANEL_ID} .sigc-pro-panel-fonte { padding: 0 10px 0 6px; font-size: 12px;
      color: #555; border-right: 1px solid #ccc; margin-right: 4px;
      white-space: nowrap; cursor: help; }
    /* Actions ON the table below them, so they sit in the tab panel
       rather than on the tab strip — where they read as extra tabs. */
    #${PANEL_ID} .sigc-pro-tab-toolbar { display: flex; gap: 6px; align-items: center;
      margin: 0 0 6px; }
    #${PANEL_ID} .sigc-pro-csv-btn,
    #${PANEL_ID} .sigc-pro-slots-reload { padding: 3px 8px; border: 1px solid #ccc;
      background: #fff; cursor: pointer; font-size: 12px; line-height: 1.6;
      color: #333; border-radius: 3px; }
    #${PANEL_ID} .sigc-pro-csv-btn:hover,
    #${PANEL_ID} .sigc-pro-slots-reload:hover { background: #eef6ff; border-color: #005a9c; }
    #${PANEL_ID} .sigc-pro-slots-reload[disabled] { opacity: .5; cursor: default; }
    #${PANEL_ID} .sigc-pro-slots-stamp { font-size: 11px; color: #777; }
    #${PANEL_ID} .sigc-pro-tab-btn { padding: 8px 16px; border: 0; background: transparent;
      cursor: pointer; border-bottom: 3px solid transparent; }
    #${PANEL_ID} .sigc-pro-tab-active { background: #fff; border-bottom-color: #005a9c; font-weight: 600; }
    #${PANEL_ID} .sigc-pro-panel-close { margin-left: auto; border: 0; background: transparent;
      font-size: 20px; cursor: pointer; padding: 0 8px; }
    #${PANEL_ID} .sigc-pro-tab-panel { display: none; flex: 1; overflow: auto; }
    #${PANEL_ID} .sigc-pro-tab-panel-active { display: block; }
    #sigc-pro-leaflet-map { width: 100%; height: 100%; }
    .sigc-pro-zonas-table { border-collapse: collapse; width: 100%; }
    .sigc-pro-zonas-table th, .sigc-pro-zonas-table td { border: 1px solid #ddd; padding: 4px 8px; text-align: right; }
    /* Pin, Zona and Nome are the text columns; every count stays right-aligned.
       Widened from -n+2 when the pin column was inserted at the front. */
    .sigc-pro-zonas-table th:nth-child(-n+2), .sigc-pro-zonas-table td:nth-child(-n+2) { text-align: left; }
    /* The Entrevistadores table has no pin column, so only its first
       column is textual; the areas cell is a list, back to the left. */
    .sigc-pro-entrevistadores-table th:nth-child(2), .sigc-pro-entrevistadores-table td:nth-child(2) { text-align: right; }
    .sigc-pro-entrevistadores-table td.sigc-pro-areas-cell { text-align: left; font-size: 11px; min-width: 18rem; max-width: 28rem; }
    .sigc-pro-zonas-table th { background: #f4f4f4; }
    /* Hover still highlights the whole row — it marks what the pin will act
       on — but the pointer cursor now belongs to the pin alone, since the
       row itself is no longer a click target. */
    .sigc-pro-zonas-table tr.sigc-pro-zona-row-clickable:hover { background: #eef6ff; }
    .sigc-pro-zona-pin-col { width: 1%; white-space: nowrap; padding-right: 2px !important; }
    .sigc-pro-zona-pin { cursor: pointer; user-select: none; line-height: 1; }
    .sigc-pro-zona-pin:focus-visible { outline: 2px solid #0645ad; outline-offset: 1px; }
    /* Zona owing more biomarcador visits than it has bookable slots. Amber
       wash plus a left rule — the row stays readable and still highlights
       on hover, so the flag never fights the click affordance. Colour is
       not the only signal: the row's title spells the shortfall out. */
    .sigc-pro-zonas-table tr.sigc-pro-zona-sem-capacidade { background: #fff4e0; }
    .sigc-pro-zonas-table tr.sigc-pro-zona-sem-capacidade:hover { background: #ffe9c7; }
    .sigc-pro-zonas-table tr.sigc-pro-zona-sem-capacidade td:first-child {
      box-shadow: inset 3px 0 0 #D55E00; }
    .sigc-pro-zonas-table td.sigc-pro-devidas { font-weight: 700; }
    .sigc-pro-zonas-hint { margin: 0 0 8px; font-size: 12px; color: #555; }
    /* Set apart from the three data tabs: it is documentation, not a fourth
       view of the households. A left rule and muted colour do that without
       margin-left:auto, which would fight the close button's own auto
       margin and strand it mid-bar. */
    #${PANEL_ID} .sigc-pro-tab-entenda { color: #555;
      border-left: 1px solid #ddd; margin-left: 6px; }
    .sigc-pro-entenda { padding: 12px 16px; max-width: 70em; font-size: 13px;
      line-height: 1.5; }
    .sigc-pro-entenda h4 { margin: 18px 0 6px; font-size: 13px; }
    .sigc-pro-entenda-fonte { margin: 0 0 4px; }
    .sigc-pro-entenda-legenda-prov { margin: 0 0 8px; color: #555; font-size: 12px; }
    .sigc-pro-entenda-table { border-collapse: collapse; width: 100%; }
    .sigc-pro-entenda-table th, .sigc-pro-entenda-table td {
      border: 1px solid #ddd; padding: 4px 8px; text-align: left;
      vertical-align: top; }
    .sigc-pro-entenda-table thead th { background: #f4f4f4; }
    .sigc-pro-entenda-table tbody th { font-weight: 600; white-space: nowrap; }
    /* The grade is spelled out in the text too — never colour alone, so it
       survives printing, greyscale and colour blindness. */
    .sigc-pro-prov { font-size: 10px; font-weight: 700; padding: 1px 5px;
      border-radius: 3px; white-space: nowrap; }
    .sigc-pro-prov-relato { background: #e6f2ea; color: #005c3c; }
    .sigc-pro-prov-derivado { background: #e7eff7; color: #00456e; }
    .sigc-pro-prov-inferencia { background: #fff0e0; color: #8a3b00; }
    .sigc-pro-entenda-cores, .sigc-pro-entenda-limites { margin: 0; padding-left: 18px; }
    .sigc-pro-entenda-cores { list-style: none; padding-left: 0; }
    .sigc-pro-entenda-cores li { display: inline-block; margin: 0 14px 4px 0; }
    .sigc-pro-entenda-swatch { display: inline-block; width: 10px; height: 10px;
      margin-right: 4px; border: 1px solid rgba(0,0,0,.25); vertical-align: middle; }
    .sigc-pro-entenda-limites li { margin-bottom: 6px; }
    /* Secondary to the id it follows: the id is what you sort and filter
       by, the name is what tells you where that is. */
    .sigc-pro-zona-nome { color: #666; font-size: 11px; }
    .sigc-pro-controle-label span { font-size: 10px; font-weight: 600; color: #fff;
      padding: 1px 4px; border-radius: 3px; white-space: nowrap;
      box-shadow: 0 0 2px rgba(0,0,0,.6); }
    /* Domicílio number drawn over its status circle. Non-interactive, so
       clicks fall through to the circleMarker underneath; white text with
       a dark halo stays legible over every status color in the palette. */
    .sigc-pro-domicilio-num { pointer-events: none; }
    .sigc-pro-domicilio-num span { display: flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; font-size: 10px; font-weight: 700; color: #fff;
      font-family: system-ui, sans-serif; line-height: 1;
      text-shadow: 0 0 2px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.7); }
    .sigc-pro-status-legend { background: #fff; padding: 6px 8px; border-radius: 4px;
      font-size: 11px; line-height: 1.6; box-shadow: 0 0 4px rgba(0,0,0,.3); }
    .sigc-pro-domicilios-table { border-collapse: collapse; width: 100%; }
    .sigc-pro-domicilios-table th, .sigc-pro-domicilios-table td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    .sigc-pro-domicilios-table th { background: #f4f4f4; }
    .sigc-pro-futura { font-weight: 700; color: #161; }
    .sigc-pro-passada { color: #777; }
    /* Deadline within the alert window or already past. Colour is not the
       only signal: the Prazo cell shows the number (negative when
       overdue), the Ação cell says what to do, and the row is sortable by
       urgency — so this survives being printed or read colourblind. */
    .sigc-pro-prazo-alerta-row { background: #fff4e0; }
    .sigc-pro-prazo-alerta { font-weight: 700; color: #A63603; }
    /* The day count is carried in the cell so the CSV exporter can read
       it on every row, rendered or not (see celulaParaTexto). While the
       deadline runs it IS the reading; once it has passed it is hidden
       and "Vencido" stands alone — off-screen rather than display:none,
       so a screen reader still reaches it. */
    .sigc-pro-prazo-cell { position: relative; }
    .sigc-pro-prazo-num-oculto { position: absolute; left: -9999px; top: 0;
      white-space: nowrap; }
    /* Slots livres cell: inline, left-aligned against the numeric columns
       around it, and compact enough that a fortnight of open times still
       fits one table cell — one line per day, "dd/mm HH:MM HH:MM". */
    .sigc-pro-zonas-table td.sigc-pro-slots-cell { text-align: left; font-size: 11px;
      line-height: 1.5; min-width: 12rem; }
    .sigc-pro-slots-cell .sp-dia { white-space: nowrap; }
    .sigc-pro-slots-cell .sp-hora { display: inline-block; margin-right: .3rem; color: #333; }
    .sigc-pro-slots-cell .sp-livres-vazio { color: #888; margin: 0; }
  `;

  let cssInjected = false;
  function ensureCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    cssInjected = true;
  }

  // The prompt must name what is actually requested: MODO_MOVIMENTO makes
  // ONE call, and asking permission for an agenda fetch that never happens
  // trains the user to click through a prompt that didn't mean anything.
  // The inverse held until 0.2.219: the biomarcadores prompt said "duas"
  // while three requests were made — the Último Movimento posições fetch
  // was added without updating this text.
  const FETCH_CONSENT_MSG =
    'SIGC-PRO: isto fará três consultas ao próprio servidor do SIGC — a ' +
    'Lista de Endereços (coordenadas e zona) e o Último Movimento ' +
    '(posição de cada questionário), ambos do mesmo recorte filtrado no ' +
    'relatório, e a agenda da UF. Nenhum dado sai do IBGE. Continuar?';

  const FETCH_CONSENT_MSG_SEM_AGENDA =
    'SIGC-PRO: isto fará uma consulta ao próprio servidor do SIGC — a ' +
    'Lista de Endereços (coordenadas e zona) do mesmo recorte filtrado no ' +
    'relatório. Nenhum dado sai do IBGE. Continuar?';

  // In-memory only (zero-storage guarantee): re-asked on every page
  // load, but not on every click within one.
  //
  // Parked on `window`, NOT in a plain closure variable: this file has no
  // re-entry guard (only sigc-common.js has one), so if the content
  // script is injected a second time into the same page — an extension
  // reload with the tab open, or a SIGC re-render — a second copy of this
  // IIFE runs with its own fresh `false`, and the user is asked to
  // consent again despite having just agreed. Reported live 2026-08-12
  // as "why do I have to click twice?". Shared state on window survives
  // that, exactly as window.__sigcPro itself does.
  const CONSENT_STATE_KEY = '__sigcProUltimoMovimentoMapConsent';
  const consentState = window[CONSENT_STATE_KEY] ||
    (window[CONSENT_STATE_KEY] = { fetch: false, tiles: false });

  const TILE_CONSENT_MSG =
    'SIGC-PRO: para desenhar o mapa, o navegador vai buscar imagens de ' +
    'mapa (tiles) de um servidor externo (OpenStreetMap), fora do SIGC. ' +
    'Continuar?';

  // Polls check() every 100ms for up to 20 attempts (~2s), stopping as
  // soon as it returns a truthy value. Shared by waitForLeafletUrls
  // (racing the relay's data-attributes on page load) and
  // focusZonaOnMap (racing the map's own async render after a Zonas-row
  // click) — same bounded-retry shape, only what happens on
  // success/timeout differs, via the two callbacks.
  function pollFor(check, { onFound, onTimeout }) {
    const found = check();
    if (found) { onFound(found); return; }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const value = check();
      if (value) {
        clearInterval(timer);
        onFound(value);
      } else if (attempts >= 20) {
        clearInterval(timer);
        if (onTimeout) onTimeout();
      }
    }, 100);
  }

  // MAIN world has no chrome.* — ultimo-movimento-map-relay.js (ISOLATED
  // world) resolves the vendored Leaflet bundle's extension URLs and
  // writes them as data-attributes on <html>, which IS shared between
  // MAIN and ISOLATED worlds (window is not). Read directly, no cache
  // needed: the attributes are just there once the relay has run, in
  // either injection order — see waitForLeafletUrls() below for the
  // short retry-poll covering the (rare) case this file's own script
  // starts running before the relay's has. A CustomEvent-based version
  // of this was tried first and silently failed live: MAIN-world
  // injection is not guaranteed to happen after ISOLATED-world
  // injection, so the event could fire before this file's listener
  // existed to hear it (confirmed live, 2026-08-09).
  function readLeafletUrls() {
    const { sigcProLeafletJsUrl: jsUrl, sigcProLeafletCssUrl: cssUrl } = document.documentElement.dataset;
    return (jsUrl && cssUrl) ? { jsUrl, cssUrl } : null;
  }

  // Detects the Último Movimento report page the same way
  // ultimo-movimento-export.js does — reuse that detection rather than
  // reimplementing it, since both rely on the same page title/table id.
  function onUltimoMovimento() {
    return window.__sigcProUltimoMovimentoExportInternals &&
      window.__sigcProUltimoMovimentoExportInternals.onUltimoMovimento();
  }

  // --- The Entenda tab --------------------------------------------------
  //
  // Every other tab shows numbers; this one says where they came from.
  //
  // The panel presents a reported status and an inferred one in the same
  // visual register — "Coletado" and "Inelegível" are both just a count in
  // a column — and the caveats live in `title` tooltips that a CSV export
  // does not carry, a screenshot does not show, and a hurried reader never
  // hovers. That gap is the tool's main epistemic risk: it invites acting
  // on a guess as though it were a fact.
  //
  // So each entry carries its PROVENANCE explicitly, in three grades:
  //   RELATO    — the SIGC report states it; we only counted it.
  //   DERIVADO  — computed from reported fields by a rule that cannot be
  //               wrong about the data, only about the question (e.g.
  //               Déficit is a subtraction; the inputs are reported).
  //   INFERÊNCIA — a guess from indirect evidence, with the measurement
  //               that supports it and the UF it was measured in.
  //
  // Grades are stated in the text, not only in colour, so they survive
  // printing and copy-paste.
  const PROV_RELATO = 'RELATO';
  const PROV_DERIVADO = 'DERIVADO';
  const PROV_INFERENCIA = 'INFERÊNCIA';

  // Column explanations per variant. Deliberately built from the SAME
  // predicates classificaDomicilio uses, described in words: if the two
  // ever disagree, the tab is lying, which is worse than having no tab.
  function entendaColunas(modo) {
    const m = modo || MODO_BIOMARCADORES;
    if (!m.comDemanda) {
      return [
        ['Não distribuída', PROV_DERIVADO,
          'Domicílio selecionado na Lista de Endereços que não aparece ' +
          'no relatório — o Último Movimento cobre tudo que saiu da ' +
          'base, então a ausência significa "ainda não distribuído" — ' +
          'ou cuja Última Posição é "Não Distribuído". Todas as outras ' +
          'colunas seguem o Tipo Entrevista informado pelo relatório.'],
        ['Realizada', PROV_RELATO,
          'Tipo Entrevista = "Realizada". Diz que a ENTREVISTA terminou, e ' +
          'nada sobre o biomarcador.'],
        ['Não Iniciada', PROV_RELATO,
          'Tipo Entrevista = "Não Iniciada": nenhum desfecho de entrevista ' +
          'foi transmitido. Pode não ter começado, estar no meio do ' +
          'caminho ou ter terminado sem descarregar por completo — o ' +
          'relatório não distingue.'],
        ['Dom. Fechado', PROV_RELATO, 'Tipo Entrevista = "Domicílio Fechado".'],
        ['Recusa entrev.', PROV_RELATO,
          'Recusou a ENTREVISTA. Este relatório não enxerga quem recusou só ' +
          'a coleta de biomarcadores — essa recusa aparece aqui como ' +
          'entrevista realizada.'],
        ['Outros', PROV_RELATO,
          'Demais valores de Tipo Entrevista, incluindo os em branco.'],
      ];
    }
    return [
      ['A entrevistar', PROV_RELATO,
        'Última Posição é "Não Distribuído", "Distribuido" ou "Enviado ' +
        'para Carga": a entrevista ainda não aconteceu — não é atraso ' +
        'de coleta.'],
      ['Em campo (indefinida)', PROV_RELATO,
        'Saiu da distribuição, mas o SIGC não registrou tipo de entrevista. ' +
        'NÃO afirma que a entrevista começou: afirma que não há desfecho.'],
      ['Sem agendamento iniciado', PROV_DERIVADO,
        'Entrevista realizada e sem prazo de coleta — o item 25A.01 ' +
        '("deseja iniciar o agendamento?") nunca foi respondido. Sem prazo ' +
        'correndo, mas também sem coleta encaminhada.'],
      ['Agendamento pendente', PROV_DERIVADO,
        'Entrevista realizada, prazo do biomarcador correndo e sem horário ' +
        'marcado. É a fila de trabalho da zona; inclui agendamento vencido.'],
      ['Vencidos', PROV_DERIVADO,
        'Quantos dos "Agendamento pendente" já passaram do prazo. Estão ' +
        'CONTIDOS naquela coluna — as duas não se somam.'],
      ['Agendado', PROV_RELATO, 'Status "Agendado" com data futura.'],
      ['Coletado', PROV_RELATO,
        'Status de coleta realizada (sangue, urina ou ambos).'],
      ['Recusa biomarc.', PROV_RELATO,
        'Recusou a COLETA. A entrevista costuma ter sido realizada. Quem ' +
        'recusou as DUAS conta aqui, não em "Recusa entrev." — as colunas ' +
        'precisam somar o Total.'],
      ['Recusa entrev.', PROV_RELATO,
        'Recusou a ENTREVISTA, então não se chegou à coleta. Reverter exige ' +
        'convencer sobre a pesquisa inteira, não sobre o exame.'],
      ['Inelegível', PROV_INFERENCIA,
        'Entrevista concluída e descarregada sem abrir o biomarcador, e sem ' +
        'prazo. Morador selecionado com menos de 35 anos ou outra ' +
        'inelegibilidade.'],
      ['Encerrado sem entrevista', PROV_RELATO,
        'Sem entrevista aproveitável: domicílio vago, uso ocasional, ' +
        'demolido, fora de âmbito ou encerrado por outro motivo.'],
      ['Déficit', PROV_DERIVADO,
        'Agendamento pendente MENOS os slots livres na janela agendável. ' +
        'Positivo: a zona deve mais coletas do que consegue marcar. ' +
        'ATENÇÃO: um slot que atende várias zonas é contado inteiro em cada ' +
        'uma delas, então a capacidade pode estar superestimada e o déficit ' +
        'subestimado quando há slots compartilhados.'],
    ];
  }

  // What this variant CANNOT answer. First person plural avoided on
  // purpose: these are limits of the report, not of the reader.
  function entendaLimites(modo) {
    const m = modo || MODO_BIOMARCADORES;
    if (!m.comDemanda) {
      return [
        'Este relatório não informa a situação do biomarcador. Não há como ' +
        'saber daqui quem já coletou, quem está agendado nem quem deve ' +
        'coleta — por isso o painel não mostra nenhuma coluna de demanda.',
        'No mapa, quem recusou a COLETA aparece como "Realizada" (verde), ' +
        'igualzinho a quem já coletou: a recusa da coleta acontece depois ' +
        'de uma entrevista bem-sucedida, e é isso que este relatório viu. ' +
        'Para enxergar recusas de coleta, abra o Relatório de ' +
        'Acompanhamento de Biomarcadores.',
        'Sem consulta à agenda: não há agendamentos nem slots livres aqui.',
        'Sem zona: esta página agrupa por controle. A zona é a unidade da ' +
        'agenda, e sem consulta à agenda não há o que comparar por zona — ' +
        'para ver o andamento por zona, abra o Relatório de Acompanhamento ' +
        'de Biomarcadores.',
      ];
    }
    return [
      'Os slots livres contam um slot inteiro em cada zona que ele atende. ' +
      'Onde há slots compartilhados entre zonas, a capacidade soma mais do ' +
      'que existe de fato — confira na aba Slots Abertos da Agenda, que ' +
      'mostra também a fração ponderada.',
      'Tudo aqui é uma fotografia do momento da consulta. Slots são ' +
      'marcados por outras pessoas enquanto o painel está aberto; use ' +
      '"↻ Slots" para reconsultar só a agenda.',
      'As regras de classificação foram medidas na Bahia em agosto de 2026. ' +
      'Um status que o SIGC passe a usar e que não esteja previsto aqui ' +
      'aparece em rosa ("Status não reconhecido") em vez de ser absorvido ' +
      'em alguma coluna — se aparecer rosa, a regra envelheceu.',
    ];
  }

  function buildEntendaHtml(modo) {
    const m = modo || MODO_BIOMARCADORES;
    const esc = window.__sigcPro.escapeHtml;
    const grau = (g) => {
      const cls = g === PROV_INFERENCIA ? 'sigc-pro-prov-inferencia'
        : (g === PROV_DERIVADO ? 'sigc-pro-prov-derivado' : 'sigc-pro-prov-relato');
      const marca = g === PROV_INFERENCIA ? '⚠ ' : '';
      return `<span class="sigc-pro-prov ${cls}">${marca}${esc(g)}</span>`;
    };
    const colunas = entendaColunas(m).map(([nome, prov, texto]) => (
      `<tr><th scope="row">${esc(nome)}</th><td>${grau(prov)}</td>` +
      `<td>${esc(texto)}</td></tr>`
    )).join('');
    // Straight from legendEntries, so a colour can never be on the map
    // and missing here — the drift that a hand-written list guarantees.
    const cores = legendEntries(m).map(([label, cor]) => (
      `<li><span class="sigc-pro-entenda-swatch" style="background:${esc(cor)}"></span>` +
      `${esc(label)}</li>`
    )).join('');
    const limites = entendaLimites(m).map((t) => `<li>${esc(t)}</li>`).join('');
    return [
      '<div class="sigc-pro-entenda">',
      `<p class="sigc-pro-entenda-fonte"><b>Fonte:</b> ${esc(FONTE_LABEL[m.id])}. ` +
        `${esc(FONTE_TIP[m.id])}</p>`,
      // Which unit the tab counts and the map outlines, said once and
      // plainly: the two variants group differently, and a reader who
      // only ever opens one has nothing to compare against.
      `<p class="sigc-pro-entenda-fonte"><b>Agrupamento:</b> ${esc(
        m.comDemanda
          ? 'por ZONA, que é a unidade da agenda — os slots são criados ' +
            'por zona, então só ali faz sentido perguntar se há capacidade. ' +
            'Cada contorno no mapa é uma zona.'
          : 'por CONTROLE, a unidade de amostragem da pesquisa. Esta ' +
            'página não consulta a agenda, então não há slots nem ' +
            'capacidade a comparar por zona; cada contorno no mapa é um ' +
            'controle, com sua etiqueta no centro.')}</p>`,
      // The third grouping, stated with its provenance: on Último
      // Movimento the Entrevistador is the report's own column; on
      // biomarcadores it rides the same Último Movimento consulta that
      // fills a Última Posição — a household that consulta misses conta
      // em "Sem entrevistador", nunca some.
      '<p class="sigc-pro-entenda-fonte"><b>Entrevistadores:</b> ' +
        esc('a aba usa a coluna Entrevistador do Último Movimento' +
          (m.comDemanda
            ? ', obtida pela mesma consulta que preenche a Última ' +
              'Posição. Domicílio sem correspondência nessa consulta ' +
              'conta em "Sem entrevistador".'
            : '. Domicílio ainda sem entrevistador atribuído conta em ' +
              '"Sem entrevistador".')) + '</p>',
      '<h4>De onde vem cada número</h4>',
      '<p class="sigc-pro-entenda-legenda-prov">' +
        `${grau(PROV_RELATO)} o relatório afirma; aqui só se contou. ` +
        `${grau(PROV_DERIVADO)} calculado a partir de campos informados. ` +
        `${grau(PROV_INFERENCIA)} deduzido de evidência indireta — pode errar.</p>`,
      '<table class="sigc-pro-entenda-table">',
      '<thead><tr><th>Coluna</th><th>Origem</th><th>O que conta</th></tr></thead>',
      `<tbody>${colunas}</tbody>`,
      '</table>',
      '<h4>Cores do mapa</h4>',
      `<ul class="sigc-pro-entenda-cores">${cores}</ul>`,
      '<h4>O que este painel NÃO responde</h4>',
      `<ul class="sigc-pro-entenda-limites">${limites}</ul>`,
      '</div>',
    ].join('\n');
  }

  function buildPanelHtml(joined, zonaRows, slotsPorZona, turnosPorZona, modo, hojeIso) {
    const m = modo || MODO_BIOMARCADORES;
    const esc = window.__sigcPro.escapeHtml;
    const hoje = hojeIso || new Date().toISOString().slice(0, 10);
    const zonasTable = buildZonasTableHtml(zonaRows, slotsPorZona, turnosPorZona, m);
    const domiciliosTable = buildDomiciliosTabHtml(joined, m, hoje, slotsPorZona);
    // Same counting pipeline as zonaRows, re-bucketed by the report's
    // own Entrevistador. No enderecosMap: there is no roster to seed
    // people-with-no-work rows from.
    const entrevistadorRows = aggregateZonas(joined, null, m, hoje, GRUPO_ENTREVISTADOR);
    const entrevistadoresTable = buildEntrevistadoresTableHtml(entrevistadorRows, m);
    // Surfaced on the tab itself: an alert buried in a table of hundreds
    // that nobody scrolls to is not an alert. Sorting by Prazo then puts
    // them on top (overdue first, since the recomputed count goes
    // negative).
    const nAlertas = m.comDemanda
      ? (joined || []).filter((r) => emAlertaDePrazo(r, hoje)).length
      : 0;
    const alertaLabel = nAlertas > 0
      ? ` — ${nAlertas} com prazo a vencer` : '';
    // One per DATA tab — the Mapa has no table, and a CSV button there
    // would promise a file it cannot build. Sits beside its own tab
    // rather than in a corner, so which table it exports is never in
    // question; the icon keeps it from competing with the tab label.
    // Beside the table it acts on, not on the tab strip. There it read as
    // a third tab and its click had to be stopped from switching tabs;
    // here it is plainly an action ON this table, and has room for a
    // label instead of a bare glyph.
    const csvBtn = (aba, nome) =>
      `<button type="button" class="sigc-pro-csv-btn" data-csv-aba="${aba}"` +
      ` title="Baixar a aba ${esc(nome)} em CSV">⤓ CSV</button>`;
    // Slots go stale while the panel is open — someone else books one —
    // and rebuilding the panel to see that costs three requests. This one
    // re-asks only the agenda, over the same short window.
    const recarregarBtn =
      '<button type="button" class="sigc-pro-slots-reload"' +
      ' title="Reconsultar os slots livres na agenda">↻ Slots</button>';
    // Only shown when at least one row is actually clickable — no point
    // telling the user to click a zona if none have mapped coordinates.
    // The demand sentences are dropped with the columns they describe:
    // explaining a highlight this variant never paints is worse than
    // saying nothing.
    const gPainel = grupoDe(m);
    const zonasHint = zonaRows.some(zonaRowIsClickable)
      ? '<p class="sigc-pro-zonas-hint">Clique no 📍 de ' +
        `${gPainel.campo === 'controle' ? 'um controle para vê-lo' : 'uma zona para vê-la'}` +
        ' no mapa.' +
        (m.comSlots
          ? ' Linhas destacadas devem mais biomarcadores do que têm slots livres na janela.'
          : ' Sem consulta à agenda: sem agendamentos nem slots livres.') +
        '</p>'
      : '';
    return [
      // data-sigc-pro marks the whole subtree as ours, so sigc-common.js's
      // getDataTable() can exclude every table inside it from the "find
      // the page's report table" lookup.
      `<div id="${PANEL_ID}" class="sigc-pro-panel-overlay" data-sigc-pro>`,
      '  <div class="sigc-pro-panel-box">',
      '    <div class="sigc-pro-panel-bar">',
      // Which report the panel was built from, stated rather than left to
      // be inferred. The two variants differ mostly in which columns are
      // ABSENT, and a reader who has only ever seen one has nothing to
      // compare against — so the one that runs on a proxy says so.
      `      <span class="sigc-pro-panel-fonte" title="${esc(FONTE_TIP[m.id])}">${esc(FONTE_LABEL[m.id])}</span>`,
      '      <button type="button" class="sigc-pro-tab-btn sigc-pro-tab-active" data-tab="mapa">Mapa</button>',
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="zonas">${esc(gPainel.rotuloPlural)} (${zonaRows.length})</button>`,
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="entrevistadores">Entrevistadores (${entrevistadorRows.length})</button>`,
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="domicilios">Domicílios (${joined.length})${alertaLabel}</button>`,
      // Last, and visually set apart: it is documentation, not a fourth
      // view of the data. Reachable from every tab because the question
      // it answers ("is this number a fact or a guess?") arises while
      // reading the others.
      '      <button type="button" class="sigc-pro-tab-btn sigc-pro-tab-entenda"' +
        ' data-tab="entenda" title="De onde vem cada número deste painel">❓ Entenda</button>',
      '      <button type="button" class="sigc-pro-panel-close" title="Fechar">×</button>',
      '    </div>',
      '    <div id="sigc-pro-mapa-panel" class="sigc-pro-tab-panel sigc-pro-tab-panel-active">',
      '      <div id="sigc-pro-leaflet-map"></div>',
      '    </div>',
      '    <div id="sigc-pro-zonas-panel" class="sigc-pro-tab-panel">',
      '      <div class="sigc-pro-tab-toolbar">' +
        csvBtn('zonas', gPainel.rotuloPlural) +
        (m.comSlots ? recarregarBtn : '') +
        '<span class="sigc-pro-slots-stamp"></span></div>',
      `      ${zonasHint}`,
      `      ${zonasTable}`,
      '    </div>',
      '    <div id="sigc-pro-entrevistadores-panel" class="sigc-pro-tab-panel">',
      `      <div class="sigc-pro-tab-toolbar">${csvBtn('entrevistadores', 'Entrevistadores')}</div>`,
      `      ${entrevistadoresTable}`,
      '    </div>',
      '    <div id="sigc-pro-domicilios-panel" class="sigc-pro-tab-panel">',
      `      <div class="sigc-pro-tab-toolbar">${csvBtn('domicilios', 'Domicílios')}</div>`,
      `      ${domiciliosTable}`,
      '    </div>',
      '    <div id="sigc-pro-entenda-panel" class="sigc-pro-tab-panel">',
      `      ${buildEntendaHtml(m)}`,
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  // Swaps a panel's table for freshly built markup, taking DataTables
  // down first. DataTables wraps the table in a container holding the
  // length selector, filter box, info line and pagination; replacing only
  // the <table> leaves that container behind, and since the new table is
  // no longer a DataTable, initPanelTables initialises it and nests a
  // SECOND container inside the first. Every reload then stacked one more
  // "50 linhas por página" and one more pagination block.
  function substituirTabela(painel, html) {
    const tabela = painel && painel.querySelector('table');
    if (!tabela) return;
    const jq = window.jQuery || window.$;
    if (jq && jq.fn && jq.fn.dataTable && jq.fn.dataTable.isDataTable &&
        jq.fn.dataTable.isDataTable(tabela)) {
      try {
        jq(tabela).DataTable().destroy();
      } catch (err) {
        // A failed destroy is not fatal — the replacement below still
        // happens; at worst the chrome is rebuilt rather than reused.
        console.warn(`${TAG} não foi possível destruir a DataTable:`, err);
      }
    }
    // Replace the WRAPPER when one survived destroy(): a wrapper left in
    // the DOM keeps its own length selector, filter box and pagination,
    // and the freshly built table would sit inside it with a second set.
    const alvo = tabela.closest('.dataTables_wrapper, .dt-container, .dt-wrapper') || tabela;
    alvo.outerHTML = html;
  }

  // Re-asks the agenda alone and repaints the columns that depend on it.
  // The households have not changed — only who booked what — so refetching
  // the report, the coordinates and the posições would be three wasted
  // requests and would reset the reader's sort and filter.
  //
  // Clears the agenda cache first: it holds a 5-minute TTL precisely
  // because someone else's booking makes these counts wrong, and pressing
  // a reload button that returns a cached answer is worse than no button.
  async function recarregarSlots(panelEl, zonaRows, joined, modo, filtro, hojeIso) {
    const AM = window.__sigcProAgendaLookups;
    const hoje = hojeIso || new Date().toISOString().slice(0, 10);
    const btn = panelEl.querySelector('.sigc-pro-slots-reload');
    const stamp = panelEl.querySelector('.sigc-pro-slots-stamp');
    if (btn) btn.disabled = true;
    try {
      AM.resetAgendaCache();
      const minDateIso = primeiroDiaAgendavel(hoje);
      const fimIso = fimDaJanela(hoje);
      const agenda = await AM.fetchAgendaSlots(
        filtro.IdUf, `${minDateIso}T00:00:00`, `${fimIso}T23:59:59`);
      const slots = agenda.dados || [];
      const slotsPorZona = new Map();
      zonaRows.forEach((z) => {
        const zonaKey = z.idZona || '';
        slotsPorZona.set(zonaKey, AM.agruparPorDia(
          AM.slotsLivresDaJanela(slots, zonaKey, minDateIso, fimIso)));
      });
      const turnosPorZona = AM.indexZonaLivres(slots, minDateIso, fimIso);
      const zonasPanel = panelEl.querySelector('#sigc-pro-zonas-panel');
      const domPanel = panelEl.querySelector('#sigc-pro-domicilios-panel');
      substituirTabela(zonasPanel, buildZonasTableHtml(
        zonaRows, slotsPorZona, turnosPorZona, modo));
      substituirTabela(domPanel,
        buildDomiciliosTabHtml(joined, modo, hoje, slotsPorZona));
      initPanelTables(panelEl);
      wireZonaRowClicks(panelEl, joined, modo);
      if (stamp) {
        // Without this the reader cannot tell a fresh count from one read
        // twenty minutes ago, which is the whole point of the button.
        stamp.textContent = `slots lidos ${new Date().toTimeString().slice(0, 5)}`;
      }
    } catch (err) {
      console.warn(`${TAG} recarga de slots falhou:`, err);
      alert(`SIGC-PRO: não foi possível reconsultar os slots (${err && err.message}).`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function closePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    currentMap = null;
  }

  // Shared by the tab-button clicks below and by a Zonas-row click
  // (see wireZonaRowClicks) — both need to switch the active tab, only
  // the row click also needs to run extra logic (fitBounds) afterward.
  function switchToTab(panelEl, tabName) {
    panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((b) => {
      b.classList.toggle('sigc-pro-tab-active', b.dataset.tab === tabName);
    });
    panelEl.querySelectorAll('.sigc-pro-tab-panel').forEach((p) => p.classList.remove('sigc-pro-tab-panel-active'));
    const target = document.getElementById(`sigc-pro-${tabName}-panel`);
    if (target) target.classList.add('sigc-pro-tab-panel-active');
    if (tabName === 'mapa') maybeLoadTiles();
  }

  // --- CSV export per tab ----------------------------------------------
  //
  // Read from the RENDERED table, not re-derived from the row objects.
  // The two variants show different columns, so a CSV built from its own
  // code path would drift from the table sitting next to the button —
  // and the whole promise of this feature is "what you see, in a file".
  //
  // Goes through the DataTables API when the table is initialized:
  // DataTables renders only the current page into the DOM, so scraping
  // tbody would silently export 25 rows out of hundreds. Same reason
  // readUltimoMovimentoTable() reads the report that way.
  const CSV_COL_IGNORADA = 'sigc-pro-zona-pin-col';

  function celulaParaTexto(td) {
    // Cells that opt in export their sort key instead of their text.
    // "Prazo" renders the WORD "Vencido" once the deadline has passed —
    // how long ago changes nothing about what to do — but a spreadsheet
    // cannot sort on a word mixed into a column of day counts. The
    // export carries the number, so sorting survives the round trip.
    //
    // Read from the cell's own content, not from data-order: DataTables
    // strips attributes off the rows it hands back, so the attribute is
    // there only for rows that happen to be rendered. The span is part
    // of the cell and survives either path.
    const num = td.querySelector && td.querySelector('.sigc-pro-prazo-num');
    if (num) return String(num.textContent || '').trim();
    // Whitespace-collapsed: the Slots livres cell is a block of per-day
    // markup whose newlines would otherwise break the CSV row.
    return String(td.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // A cell as DataTables hands it back: the INNER html of the <td>, with
  // the attributes gone — so `data-order` is unreachable and the Prazo
  // column would export "Vencido" as text. The wrapper restores a real
  // <td> the same reader can handle, taking the attributes from the
  // corresponding header cell's own <td> when one is rendered.
  //
  // DOMParser is inert: it never fetches or runs anything, so parsing
  // live table content keeps the zero-network guarantee.
  function celulaHtmlParaTexto(html, atributos) {
    const attrs = atributos || '';
    const doc = new DOMParser().parseFromString(
      `<table><tbody><tr><td ${attrs}>${String(html == null ? '' : html)}` +
      '</td></tr></tbody></table>', 'text/html');
    const td = doc.querySelector('td');
    return td ? celulaParaTexto(td) : '';
  }

  // Every row, not just the rendered page. DataTables keeps the full
  // dataset in rows().data() while the DOM holds only the current page —
  // reading tbody (or rows().nodes(), which yields only RENDERED nodes)
  // exported 50 rows out of hundreds. Same API readDataTable() uses, for
  // exactly this reason.
  //
  // Returns rows of live <td> nodes. The DataTables path rebuilds them
  // from the dataset, borrowing each column's attributes from the first
  // rendered row so class/data-order survive for the off-page rows too.
  function linhasDaTabela(tabela) {
    const jq = window.jQuery || window.$;
    if (jq && jq.fn && jq.fn.dataTable && jq.fn.dataTable.isDataTable &&
        jq.fn.dataTable.isDataTable(tabela)) {
      try {
        const dados = jq(tabela).DataTable().rows().data().toArray();
        const modelo = [...tabela.querySelectorAll('tbody tr')][0];
        const attrsPorColuna = modelo
          ? [...modelo.querySelectorAll('td')].map((td) =>
            [...td.attributes].filter((a) => a.name !== 'data-order')
              .map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' '))
          : [];
        return dados.map((linha) => Array.from(linha).map((celula, i) => ({
          html: celula, attrs: attrsPorColuna[i] || '',
        })));
      } catch (err) {
        // Fall through to the DOM: a partial export beats none, and the
        // caller has no way to act on this failure.
        console.warn(`${TAG} DataTables rows() falhou, lendo o DOM:`, err);
      }
    }
    return [...tabela.querySelectorAll('tbody tr')].map(
      (tr) => [...tr.querySelectorAll('td')]);
  }

  function tabelaParaCsv(tabela) {
    if (!tabela) return null;
    const ths = [...tabela.querySelectorAll('thead th')];
    // The pin column is a control, not data — exporting a 📍 glyph as a
    // field would be noise in every row.
    const manter = ths.map((th) => !th.classList.contains(CSV_COL_IGNORADA));
    const header = ths.filter((_, i) => manter[i]).map(celulaParaTexto);
    const rows = linhasDaTabela(tabela).map((celulas) =>
      celulas.filter((_, i) => manter[i] !== false).map((c) =>
        (c && c.html !== undefined
          ? celulaHtmlParaTexto(c.html, c.attrs)
          : celulaParaTexto(c))));
    return { header, rows };
  }

  const CSV_FONTE_SLUG = {
    biomarcadores: 'biomarcadores',
    movimento: 'ultimo-movimento',
  };

  // Names the variant as well as the tab: the same "zonas" tab exports
  // different columns from each page, and two files called
  // sigc-pro-zonas-<date>.csv would be indistinguishable in a downloads
  // folder.
  function nomeCsvAba(aba, modo, hojeIso) {
    const m = modo || MODO_MOVIMENTO;
    const dia = hojeIso || new Date().toISOString().slice(0, 10);
    // The tab's internal id stays "zonas" in both variants, but the file
    // must name what its rows actually are — on Último Movimento they
    // are controles, and "zonas" in the filename would resurrect the
    // grouping that page no longer uses.
    const slug = aba === 'zonas' && grupoDe(m).campo === 'controle'
      ? 'controles' : aba;
    return `sigc-pro-${CSV_FONTE_SLUG[m.id]}-${slug}-${dia}.csv`;
  }

  function baixarCsvDaAba(panelEl, aba, modo) {
    const painel = panelEl.querySelector(`#sigc-pro-${aba}-panel`);
    const tabela = painel && painel.querySelector('table');
    const dados = tabelaParaCsv(tabela);
    if (!dados || dados.rows.length === 0) {
      alert('SIGC-PRO: nada para exportar nesta aba.');
      return;
    }
    window.__sigcPro.downloadFile(
      nomeCsvAba(aba, modo),
      window.__sigcPro.buildCsv(dados.header, dados.rows));
  }

  // ctx carries what a slots reload needs (rows, filtro) — the tabs
  // themselves need none of it, so it is optional.
  function wireTabs(panelEl, modo, ctx) {
    panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchToTab(panelEl, btn.dataset.tab));
    });
    // No stopPropagation needed any more: the button lives inside its own
    // tab panel rather than on the tab strip, so its click was never
    // going to switch tabs.
    panelEl.querySelectorAll('.sigc-pro-csv-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        baixarCsvDaAba(panelEl, btn.dataset.csvAba, modo);
      });
    });
    const reload = panelEl.querySelector('.sigc-pro-slots-reload');
    if (reload && ctx) {
      reload.addEventListener('click', (event) => {
        event.preventDefault();
        recarregarSlots(panelEl, ctx.zonaRows, ctx.joined, modo, ctx.filtro, ctx.hoje);
      });
    }
    panelEl.querySelector('.sigc-pro-panel-close').addEventListener('click', closePanel);
  }

  // Clicking a clickable Zonas row (see zonaRowIsClickable) switches to
  // the Mapa tab and pans/zooms to fit that zona's (or "Sem zona"'s,
  // idZona === '') mapped domicílios — the "open the map at this zone"
  // behavior. Computed fresh from `joined` rather than persisting hull
  // point arrays from renderLeafletMap: every clickable row has at
  // least one temCoordenadas domicílio (zonaRowIsClickable's condition
  // mirrors that), regardless of whether a hull was drawable for it.
  // `idZona` is the aggregate tab's grouping key — a zona on the
  // biomarcadores variant, a Controle on Último Movimento. The pin writes
  // whichever one its row was built from, so this only has to match on
  // the same field the rows were grouped by.
  function focusZonaOnMap(panelEl, joined, idZona, modo) {
    switchToTab(panelEl, 'mapa');
    const g = grupoDe(modo);
    const coords = joined
      .filter((r) => r.temCoordenadas && (chaveGrupo(r, g).id || '') === idZona)
      .map((r) => [r.lat, r.lon]);
    if (coords.length === 0) return;

    if (currentMap) {
      currentMap.fitBounds(coords, { padding: [20, 20] });
      return;
    }
    // Map not rendered yet (first time this panel's Mapa tab is being
    // shown, or the user declined tile consent earlier — the switchToTab
    // call above already triggered maybeLoadTiles, which is a no-op in
    // the declined-consent case, and its own declined-message UI is the
    // right feedback, so this poll just gives up quietly rather than
    // fighting that UI with a second message). mapInitialized only turns
    // true after renderLeafletMap has actually run.
    pollFor(() => currentMap, { onFound: (map) => map.fitBounds(coords, { padding: [20, 20] }) });
  }

  // One household rather than a whole zona: setView at street zoom, not
  // fitBounds, because a single point has no extent to fit — fitBounds on
  // it would zoom to the maximum and lose all context.
  const ZOOM_DOMICILIO = 17;

  function focusDomicilioOnMap(panelEl, joined, chave) {
    switchToTab(panelEl, 'mapa');
    const alvo = (joined || []).find(
      (r) => r.temCoordenadas && `${r.controle}|${r.domicilio}` === chave);
    if (!alvo) return;
    // Centres on the TRUE geocode, never on a spiderfied ring position:
    // the ring is a display device, and centring on it would be off by
    // ~13 m. Today the rows handed in are the plain joined ones, so
    // lat/lon IS the geocode and origLat is absent; the guard is there
    // for the day someone passes spiderfyRows output instead, where
    // lat/lon has been moved onto the ring and origLat holds the real
    // point.
    const ll = [alvo.origLat != null ? alvo.origLat : alvo.lat,
      alvo.origLon != null ? alvo.origLon : alvo.lon];
    if (currentMap) {
      currentMap.setView(ll, ZOOM_DOMICILIO);
      return;
    }
    // Same reasoning as focusZonaOnMap: the map may not have rendered yet.
    pollFor(() => currentMap, { onFound: (map) => map.setView(ll, ZOOM_DOMICILIO) });
  }

  // Test seam: currentMap is set by renderLeafletMap, which needs a real
  // Leaflet. Focus behaviour is worth testing without one.
  function setCurrentMapForTest(map) {
    currentMap = map;
  }

  // SIGC's own page script auto-initializes DataTables over the tables it
  // finds in the document, and this panel's tables are injected into
  // document.body — so they get swept up and paged at the library's
  // 10-row default (confirmed live 2026-08-12: "Showing 1 to 10 of 90
  // entries" on the Domicílios tab).
  //
  // Rather than fight the initialization, adopt it: 50 rows is a far more
  // useful default for scanning an agência's households, and the library's
  // own "entries per page" selector still lets the user change it. A no-op
  // when DataTables never claimed these tables (then they simply render in
  // full, which is also fine).
  const PANEL_PAGE_LENGTH = 50;

  // DataTables ships English chrome; every other string in this panel is
  // Portuguese, so the table's own controls have to be too. Inlined rather
  // than fetched from DataTables' CDN language files — this extension makes
  // no third-party requests.
  const DT_PT_BR = {
    search: 'Filtrar:',
    lengthMenu: '_MENU_ linhas por página',
    info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
    infoEmpty: 'Nenhum registro',
    infoFiltered: '(filtrado de _MAX_ no total)',
    zeroRecords: 'Nenhum registro encontrado',
    emptyTable: 'Sem dados',
    paginate: { first: 'Primeira', last: 'Última', next: 'Próxima', previous: 'Anterior' },
  };

  // Every body row must have as many cells as the header has columns.
  // An empty table passes: no rows, nothing to disagree.
  function colunasBatem(tabela) {
    const nCols = tabela.querySelectorAll('thead th').length;
    if (nCols === 0) return false;
    return [...tabela.querySelectorAll('tbody tr')].every(
      (tr) => tr.querySelectorAll('td').length === nCols);
  }

  function initPanelTables(panelEl) {
    const jq = window.jQuery || window.$;
    if (!jq || !jq.fn || !jq.fn.dataTable || !panelEl) return;
    // Data tables only. The Entenda tab's glossary is prose in a table:
    // sorting it would scramble a reading order chosen to follow the
    // collection pipeline, and a search box over twelve static rows
    // invites the reader to treat documentation as data.
    panelEl.querySelectorAll('table:not(.sigc-pro-entenda-table)').forEach((tbl) => {
      // DataTables reports a column-count mismatch through its own
      // alert(), NOT a thrown error, so the try/catch below cannot
      // contain it — the user just gets a modal. The only defence is
      // never handing it a table whose body disagrees with its header.
      //
      // Our builders keep the two in step by construction (each column is
      // gated by the same flag in header and body, and there are tests
      // for that), so this is a backstop against a future edit, not a
      // known case. Refusing to initialize costs sorting and paging;
      // showing an undismissable dialog costs the whole page.
      try {
        // Initialize deliberately rather than inheriting whatever SIGC's
        // own auto-init would do: that gave a 10-row default and no say
        // over sorting. Already-claimed tables (SIGC got there first) are
        // adjusted in place instead — re-initializing throws.
        //
        // The column check guards CONSTRUCTION only: an already-claimed
        // table has been through DataTables' validation once, and
        // adjusting its page length cannot raise the mismatch alert.
        if (jq.fn.dataTable.isDataTable(tbl)) {
          jq(tbl).DataTable().page.len(PANEL_PAGE_LENGTH).draw(false);
          return;
        }
        if (!colunasBatem(tbl)) {
          console.warn(`${TAG} tabela com contagem de colunas inconsistente; ` +
            'não inicializada no DataTables.');
          return;
        }
        jq(tbl).DataTable({
          pageLength: PANEL_PAGE_LENGTH,
          lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'Todos']],
          order: [], // keep the order the panel built (zona/report order)
          language: DT_PT_BR,
        });
      } catch (err) {
        // A failed init is not fatal: the plain table still renders every
        // row, just without sorting or paging.
        console.warn(`${TAG} não foi possível inicializar a tabela:`, err);
      }
    });
  }

  // Bound to the pin, never the row: see the TIP_PIN comment in
  // buildZonasTableHtml for why the whole-row target had to go.
  //
  // role="button" is a promise that Enter and Space activate it, so both
  // are handled — a tabbable element that only responds to the mouse is
  // worse than one that isn't tabbable at all. Space is prevented from
  // scrolling the panel, its default on a focused non-button.
  function wireZonaRowClicks(panelEl, joined, modo) {
    panelEl.querySelectorAll('.sigc-pro-dom-pin').forEach((pin) => {
      const ir = () => focusDomicilioOnMap(panelEl, joined, pin.dataset.domKey || '');
      pin.addEventListener('click', (event) => { event.preventDefault(); ir(); });
      pin.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        ir();
      });
    });
    panelEl.querySelectorAll('.sigc-pro-zona-pin:not(.sigc-pro-dom-pin)').forEach((pin) => {
      const ir = () => focusZonaOnMap(panelEl, joined, pin.dataset.idZona || '', modo);
      pin.addEventListener('click', (event) => {
        event.preventDefault();
        ir();
      });
      pin.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        ir();
      });
    });
  }

  // Reads ultimo-movimento-map-relay.js's data-attributes, polling
  // briefly in case this file's own script started running before the
  // relay's has (both run at document_idle, in either order — the
  // attribute has no listener to miss, so this only needs to cover the
  // instant right at page load, not the click itself, which happens long
  // after both scripts have run).
  function waitForLeafletUrls() {
    return new Promise((resolve, reject) => {
      pollFor(readLeafletUrls, {
        onFound: resolve,
        onTimeout: () => reject(new Error('URLs do Leaflet não chegaram do relay a tempo.')),
      });
    });
  }

  // Injects Leaflet's CSS/JS from the vendored, web-accessible files on
  // first need (not at feature load) — avoids paying the load cost for
  // users who never click Mapa. Idempotent: a second call is a no-op.
  let leafletLoadPromise = null;
  function loadLeafletAssets() {
    if (leafletLoadPromise) return leafletLoadPromise;
    // urls is sourced only from readLeafletUrls() (document.documentElement's
    // data-sigc-pro-leaflet-*-url attributes — see readLeafletUrls above),
    // never anything else — keeps its provenance visible as a single,
    // consistently-named binding for check-privacy.sh's local-resource
    // scan.
    leafletLoadPromise = waitForLeafletUrls().then((urls) => new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${urls.cssUrl}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = urls.cssUrl;
        document.head.appendChild(link);
      }
      if (window.L) { resolve(window.L); return; }
      const script = document.createElement('script');
      script.src = urls.jsUrl;
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error('Falha ao carregar Leaflet.'));
      document.head.appendChild(script);
    })).catch((err) => {
      leafletLoadPromise = null; // allow a retry (e.g. via the panel's retry button) to re-poll
      throw err;
    });
    return leafletLoadPromise;
  }

  // Tile-specific consent, separate from the Lista de Endereços consent
  // — fires only once, on first attempt to actually paint the map (per
  // spec §Consent gates). Declining leaves the Mapa tab showing an
  // explanatory message with a retry button; the Zonas tab is
  // unaffected.
  //
  // Shared on window (see CONSENT_STATE_KEY above) so a second injection
  // of this content script doesn't re-ask something already answered.
  let mapInitialized = false;
  // Guards against two calls in the same tick both passing the
  // mapInitialized check (mapInitialized only turns true AFTER the async
  // loadLeafletAssets() resolves) and each constructing a Leaflet map on
  // the same container — real Leaflet then throws "Map container is
  // already initialized." Set only after the consent block (a declined
  // consent must not leave this stuck true) and always cleared in
  // `finally` so a failed load can still be retried.
  let tileLoadInFlight = false;
  let pendingJoined = null;
  // The variant the pending rows were built for, parked next to them:
  // tiles load asynchronously, so the render happens long after
  // onMapaClick resolved its modo, and re-deriving it from the DOM there
  // would risk colouring rows by a different rule than the table beside
  // them used.
  let pendingModo = MODO_MOVIMENTO;
  // Parked with the rows for the same reason: the map renders after the
  // tiles load, long after onMapaClick computed these.
  let pendingZonas = new Map();
  let pendingTurnos = new Map();
  let pendingSlots = new Map();
  // Live Leaflet map instance, once rendered — lets a Zonas-tab row
  // click (see focusZonaOnMap below) call fitBounds without threading
  // the map object through every function in between. Cleared on
  // closePanel so a stale map from a previous open can never be
  // fitBounds'd after its container is gone.
  let currentMap = null;

  // Test-only seam, same pattern as resetFilteredAgencia above: this
  // module-level tile/consent state survives between test cases, so each
  // one that exercises maybeLoadTiles needs a clean starting point.
  function resetTileState() {
    consentState.tiles = false;
    mapInitialized = false;
    tileLoadInFlight = false;
    leafletLoadPromise = null;
  }

  async function maybeLoadTiles() {
    if (mapInitialized || tileLoadInFlight) return;
    const container = document.getElementById('sigc-pro-leaflet-map');
    if (!container) return;
    if (!consentState.tiles) {
      if (!confirm(TILE_CONSENT_MSG)) {
        container.innerHTML =
          '<p class="sigc-pro-map-declined">Mapa não carregado (tiles ' +
          'recusados). <button type="button" id="sigc-pro-retry-tiles">Tentar novamente</button></p>';
        const retry = document.getElementById('sigc-pro-retry-tiles');
        if (retry) retry.addEventListener('click', maybeLoadTiles);
        return;
      }
      consentState.tiles = true;
    }
    tileLoadInFlight = true;
    try {
      const L = await loadLeafletAssets();
      renderLeafletMap(L, container, pendingJoined || [], pendingModo,
        pendingZonas, pendingTurnos, pendingSlots);
      mapInitialized = true;
    } catch (err) {
      container.innerHTML = `<p class="sigc-pro-map-declined">Falha ao carregar o mapa: ${window.__sigcPro.escapeHtml(String(err && err.message || err))}</p>`;
    } finally {
      tileLoadInFlight = false;
    }
  }

  // A building with several domicílios shares one geocode in SIGC, so
  // their markers land exactly on top of each other and only the last one
  // drawn is clickable. Rather than collapse them into a count, fan the
  // group out onto a small ring around the shared point: every domicílio
  // keeps its own number, status color and popup. Rows are grouped by a
  // ~5 m threshold (COLOCATED_EPS_DEG below) so a jittered geocode of the
  // same building collapses together with the exact matches.
  const COLOCATED_EPS_DEG = 0.00005; // ~5.5 m in latitude
  const SPIDER_RADIUS_DEG = 0.00012; // ~13 m — visibly apart at street zoom

  function spiderfyRows(rows) {
    const groups = []; // [{ lat, lon, members: [row, ...] }]
    rows.forEach((r) => {
      const hit = groups.find((g) => (
        Math.abs(g.lat - r.lat) <= COLOCATED_EPS_DEG &&
        Math.abs(g.lon - r.lon) <= COLOCATED_EPS_DEG
      ));
      if (hit) hit.members.push(r);
      else groups.push({ lat: r.lat, lon: r.lon, members: [r] });
    });
    const out = [];
    groups.forEach((g) => {
      const n = g.members.length;
      g.members.forEach((r, i) => {
        // Longitude degrees shrink with latitude; scale so the ring reads
        // as a circle on screen rather than an ellipse.
        const lonScale = 1 / Math.max(0.15, Math.cos(g.lat * Math.PI / 180));
        const angle = (2 * Math.PI * i) / n;
        out.push(Object.assign({}, r, {
          lat: n === 1 ? r.lat : g.lat + SPIDER_RADIUS_DEG * Math.sin(angle),
          lon: n === 1 ? r.lon : g.lon + SPIDER_RADIUS_DEG * lonScale * Math.cos(angle),
          origLat: r.lat,
          origLon: r.lon,
          coLocated: n,
        }));
      });
    });
    return out;
  }

  // The text drawn inside a domicílio marker: the domicílio number, which
  // in practice is 1–2 digits and so fits the circle without truncation.
  function domicilioLabel(r) {
    return window.__sigcPro.escapeHtml(String(r.domicilio));
  }

  // Pure/testable: the marker popup body for one household row. The
  // Agendado line is entirely omitted (not blank) when there is none —
  // an empty "Agendado:" line would read as a broken lookup rather than
  // "not scheduled".
  function buildPopupHtml(r, modo) {
    const m = modo || MODO_MOVIMENTO;
    const esc = window.__sigcPro.escapeHtml;
    const gmapsUrl = window.__sigcPro.gmapsPontoUrl(r.lat, r.lon);
    const gmapsLine = gmapsUrl
      ? `<br><a href="${esc(gmapsUrl)}" target="_blank" rel="noopener">Ver no Google Maps</a>`
      : '';
    const agendadoLinha = r.agendado
      ? `<br>Agendado: <span class="${r.futura ? 'sigc-pro-futura' : 'sigc-pro-passada'}">` +
        `${esc(r.agendado)}</span>`
      : '';
    // No "N domicílios neste mesmo ponto" caption: the fan and its
    // leader lines already show it, and the sentence never said WHICH
    // households shared the point — the one thing the reader wanted.
    return (
      // Agência: the map can be filtered by agência layer, so "whose
      // household is this" should be answerable without going back to
      // the table. Omitted entirely when absent — Último Movimento has
      // no such column, and an empty label is worse than no label.
      (r.agencia ? `Agência: ${esc(r.agencia)}<br>` : '') +
      `Controle: ${esc(r.controle)}<br>` +
      `Domicílio: ${esc(r.domicilio)}<br>` +
      `Entrevistador: ${esc(r.entrevistador)}<br>` +
      `Tipo: ${esc(r.tipoEntrevista)}<br>` +
      // The collection outcome, which the marker colour now encodes and
      // "Tipo" alone actively hides: a refused COLLECTION reads as
      // "Realizada" here, because the interview did succeed.
      //
      // Named "Biomarcadores", not "Coleta": this line sits right under
      // "Tipo", both are outcomes, and the whole confusion being fixed is
      // that two different things get refused. A bare "Coleta" leaves the
      // reader to infer which one — the same reason the Zonas tooltip
      // spells out "recusa da coleta de biomarcador".
      (m.comDemanda ? `Biomarcadores: ${esc(r.status || '—')}<br>` : '') +
      // Zona only where the panel groups by it. Último Movimento neither
      // aggregates nor draws by zona any more, and a lone Zona line in
      // the popup would be the one place it survived — a grouping the
      // rest of that variant cannot act on. The Controle is already two
      // lines above.
      (m.comDemanda ? `Zona: ${esc(r.idZona || 'Sem zona')}` : '') +
      agendadoLinha +
      gmapsLine
    );
  }

  // zonaPorId / turnosPorZona / slotsPorZona are optional: without them
  // the hull keeps its bare id tooltip, which is what the Último
  // Movimento variant gets.
  function renderLeafletMap(L, container, joined, modo, zonaPorId, turnosPorZona,
    slotsPorZona) {
    const m = modo || MODO_MOVIMENTO;
    const zonasIdx = zonaPorId || new Map();
    const turnosIdx = turnosPorZona || new Map();
    const slotsIdx = slotsPorZona || new Map();
    const hojeIso = new Date().toISOString().slice(0, 10);
    const withCoords = joined.filter((r) => r.temCoordenadas);
    const map = L.map(container);
    currentMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    if (withCoords.length === 0) {
      map.setView([-14, -51], 4); // Brazil-wide fallback view
      addStatusLegend(L, map, m);
      return;
    }

    // --- Layer 1: group hulls, drawn first so markers sit on top ------
    // Zona on the biomarcadores variant, Controle on Último Movimento —
    // the same unit its aggregate tab counts, so an outline on the map
    // and a row in the table always describe the same set of households.
    // On Último Movimento this also puts each hull around the Controle
    // label that layer 3 already draws at its centroid.
    const grupoMapa = grupoDe(m);
    const byZona = new Map(); // group id -> [[lat, lon], ...]
    withCoords.forEach((r) => {
      const gk = chaveGrupo(r, grupoMapa);
      if (!gk.tem || !gk.id) return; // ungrouped rows get no hull (spec §2)
      if (!byZona.has(gk.id)) byZona.set(gk.id, []);
      byZona.get(gk.id).push([r.lat, r.lon]);
    });
    byZona.forEach((coords, idZona) => {
      const hull = convexHull(coords);
      if (!hull) return;
      const color = zonaColor(idZona);
      const zonaTooltip = window.__sigcPro.escapeHtml(idZona);
      const zonaRow = zonasIdx.get(idZona);
      // Clicking the hull answers "what is in this zona and can it be
      // booked" — the same figures the Zonas row carries, without
      // leaving the map.
      const zonaPopup = zonaRow
        ? buildZonaPopupHtml(zonaRow, turnosIdx.get(idZona), slotsIdx.get(idZona), m)
        : null;
      const comPopup = (camada) =>
        (zonaPopup ? camada.bindPopup(zonaPopup) : camada);
      if (hull.type === 'polygon') {
        comPopup(L.polygon(hull.points,
          { color, weight: 2, fillColor: color, fillOpacity: 0.18 })
          .bindTooltip(zonaTooltip))
          .addTo(map);
      } else if (hull.type === 'capsule') {
        comPopup(L.polyline([hull.a, hull.b],
          { color, weight: 10, opacity: 0.35, lineCap: 'round' })
          .bindTooltip(zonaTooltip))
          .addTo(map);
      } else if (hull.type === 'circle') {
        L.circle(hull.center, { radius: 30, color, fillColor: color, fillOpacity: 0.35 })
          .bindTooltip(zonaTooltip)
          .addTo(map);
      }
    });

    // --- Layer 2: domicílio markers, colored by status ---------------
    // Co-located rows are fanned onto a ring first (spiderfyRows), so the
    // markers below never sit exactly on top of one another and each
    // domicílio number stays readable and clickable.
    const bounds = [];
    // Kept so zoomend can resize them in place; rebuilding markers on
    // every zoom would drop their popups and cost far more than a
    // setRadius pass.
    const marcadoresPorUrgencia = [];
    // One LayerGroup per agência when there is more than one to separate.
    // With a single agência every marker goes straight on the map, as
    // before — no group, no control.
    const gruposAgencia = agruparPorAgencia(withCoords);
    const usarCamadas = valeControleDeCamadas(gruposAgencia);
    const camadaPorAgencia = new Map();
    if (usarCamadas) {
      gruposAgencia.forEach((_, agencia) => {
        camadaPorAgencia.set(agencia, L.layerGroup().addTo(map));
      });
    }
    const destinoDe = (r) => camadaPorAgencia.get(
      String((r && r.agencia) || '').trim() || SEM_AGENCIA) || map;
    spiderfyRows(withCoords).forEach((r) => {
      const color = statusColor(r, m, hojeIso);
      if (r.coLocated > 1) {
        // Leader line back to the true geocode, so the ring reads as one
        // address rather than as neighbours scattered around it. This
        // replaces a written caption: at 1px and half opacity the line
        // was invisible until fully zoomed in, which is why the fan
        // needed explaining in the first place.
        L.polyline([[r.origLat, r.origLon], [r.lat, r.lon]], {
          color: '#444', weight: 1.5, opacity: 0.85, interactive: false,
        }).addTo(destinoDe(r));
        // And a dot at the shared point, or every line converges on
        // nothing and the geometry still has to be inferred.
        L.circleMarker([r.origLat, r.origLon], {
          radius: 2, color: '#444', fillColor: '#444', fillOpacity: 1,
          weight: 0, interactive: false,
        }).addTo(destinoDe(r));
      }
      // Urgent markers are bigger and darker-edged, and the radius tracks
      // zoom (see raioPorZoom): what needs action is a small minority —
      // in BA, dozens against ~1.600 "Não iniciado" — so colour alone
      // loses it in the crowd.
      const urgente = marcadorUrgente(r, m, hojeIso);
      const marker = L.circleMarker([r.lat, r.lon], {
        radius: raioPorZoom(map.getZoom(), urgente),
        color: corDaBorda(urgente),
        weight: urgente ? 2 : 1,
        fillColor: color,
        fillOpacity: 0.8,
      }).addTo(destinoDe(r));
      marcadoresPorUrgencia.push({ marker, urgente });
      // The number rides in its own non-interactive divIcon centered on
      // the circle — circleMarker itself cannot carry text.
      L.marker([r.lat, r.lon], {
        icon: L.divIcon({
          className: 'sigc-pro-domicilio-num',
          html: `<span>${domicilioLabel(r)}</span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        interactive: false,
      }).addTo(destinoDe(r));
      // gmapsPontoUrl (just pins the point — no turn-by-turn directions)
      // is always non-empty here (withCoords already filtered to
      // temCoordenadas rows), same outbound-link-only pattern
      // lista-agenda.js's own domicílio table uses (via the sibling
      // gmapsDestinoUrl) — a link the user clicks, never a request the
      // extension makes itself.
      // Popup and bounds both use the TRUE geocode, never the fanned ring
      // position: the Google Maps link must pin the real address, and the
      // fitBounds box must not be inflated by the fan offsets.
      marker.bindPopup(buildPopupHtml(
        Object.assign({}, r, { lat: r.origLat, lon: r.origLon }), m));
      bounds.push([r.origLat, r.origLon]);
    });

    // --- Layer 3: Controle labels, always visible ---------------------
    // Muted purple/violet family, deliberately outside the Okabe-Ito set
    // ZONA_PALETTE and STATUS_* already exhaust — keeps Controle labels
    // visually distinct from both the status marker colors and the zona
    // hull colors (spec's distinct-palette requirement).
    const CONTROLE_LABEL_COLOR = {
      inactive: '#5C5C8A',
      active: '#4A148C',
      partial: '#AB47BC',
    };
    controleCentroids(joined).forEach(({ controle, lat, lon, colorState }) => {
      const shortId = String(controle).slice(-6);
      const color = CONTROLE_LABEL_COLOR[colorState];
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'sigc-pro-controle-label',
          html: `<span style="background:${color};" title="${window.__sigcPro.escapeHtml(String(controle))}">${window.__sigcPro.escapeHtml(shortId)}</span>`,
          iconSize: null,
        }),
        interactive: false,
      }).addTo(map);
    });

    // Resize in place on zoom. fitBounds below fires this too, so the
    // initial radii land at the zoom the map actually settles on rather
    // than the one it was constructed with.
    map.on('zoomend', () => {
      const z = map.getZoom();
      marcadoresPorUrgencia.forEach(({ marker, urgente }) => {
        marker.setRadius(raioPorZoom(z, urgente));
      });
    });

    // Overlays only: there is one base layer (OSM), so offering it as a
    // choice would just invite turning the map off.
    if (usarCamadas) {
      const overlays = {};
      camadaPorAgencia.forEach((camada, agencia) => {
        overlays[`Agência ${agencia} (${gruposAgencia.get(agencia).length})`] = camada;
      });
      // Expanded, not collapsed: the collapsed form is a button whose
      // only content is background-image: url(images/layers.png), and
      // that file is not vendored — only the three marker PNGs are — so
      // it rendered as an empty white square. Expanded needs no icon,
      // and with a handful of agências the list is the useful state
      // anyway.
      L.control.layers(null, overlays, { collapsed: false }).addTo(map);
    }

    addStatusLegend(L, map, m);
    map.fitBounds(bounds, { padding: [20, 20] });
  }

  // Fixed corner legend for the 6 marker-status colors (spec: "Status
  // legend" section) — no separate legend for hull or Controle-label
  // colors, per the design's explicit scope decision. Takes L explicitly
  // (matching renderLeafletMap's own established style of receiving L as
  // a parameter) rather than closing over window.L.
  // One entry per colour the ACTIVE scale can emit, and no others: a
  // legend listing a colour the map never draws is worse than a shorter
  // legend, because the reader goes looking for it.
  function legendEntries(modo) {
    const m = modo || MODO_MOVIMENTO;
    if (!m.comDemanda) {
      return [
        ['Não distribuída', STATUS_INATIVO],
        ['Realizada', STATUS_REALIZADA],
        // Named in full: on the map there is no header tooltip to carry
        // the distinction (see TIP_RECUSA).
        ['Recusa da entrevista', STATUS_RECUSA],
        ['Não Iniciada', STATUS_NAO_INICIADA],
        ['Domicílio Fechado', STATUS_FECHADO],
        ['Outros', STATUS_OUTROS],
      ];
    }
    return [
      ['Coletado', BIO_COLETADO],
      ['Agendado', BIO_AGENDADO],
      ['A agendar / vencido', BIO_ACAO],
      // "do biomarcador", not "da coleta": it sits directly above "Recusa
      // da entrevista", and the pair is the whole point of the split.
      ['Recusa do biomarcador', BIO_RECUSA_COLETA],
      ['Recusa da entrevista', BIO_RECUSA_ENTREVISTA],
      // Qualified for the same reason as the two Recusas: 'Outro Motivo'
      // is also a tipoEntrevista value, and a household can carry one in
      // each field (BA: 12 biomarcador against 2 interview, no overlap).
      ['Outro motivo (biomarcador)', BIO_OUTRO_MOTIVO],
      ['Não elegível', BIO_NAO_ELEGIVEL],
      ['Sem entrevista (reversível)', BIO_BLOQUEADO],
      ['Não iniciado', BIO_NAO_INICIADO],
      ['Status não reconhecido', BIO_DESCONHECIDO],
    ];
  }

  function addStatusLegend(L, map, modo) {
    const entries = legendEntries(modo);
    const div = L.DomUtil.create('div', 'sigc-pro-status-legend');
    div.innerHTML = entries.map(([label, color]) => (
      `<div><span style="display:inline-block;width:10px;height:10px;background:${color};margin-right:4px;"></span>${window.__sigcPro.escapeHtml(label)}</div>`
    )).join('');
    const control = L.control({ position: 'bottomleft' });
    control.onAdd = () => div;
    control.addTo(map);
  }

  // The biomarcadores report's own rows, shaped like the movimento rows
  // the rest of this file consumes (same controle|domicilio key, same
  // {tipoEntrevista, idZona} fields), so joinEnderecos and aggregateZonas
  // need no variant of their own.
  //
  // Two fields come straight from the report and cost no request:
  //   status  — the literal collection outcome, replacing the
  //             ultimaPosicao proxy that erred in both directions.
  //   agendado — from Data Agendada. The agenda IS still fetched in this
  //             mode, but only for free slots per zona; the booking of a
  //             specific household is authoritative here.
  //
  // ultimaPosicao stays empty: this report has no such column, and the
  // Domicílios tab's "Situação" renders '—' for it rather than borrowing
  // a value from a different report.
  function biomarcadoresParaLinhas(headers, rows) {
    const AM = window.__sigcProAgendaLookups;
    const base = AM.tableToBiomarcadoresMap(headers, rows);
    if (!base) return null;
    const out = new Map();
    base.forEach((r, key) => {
      const iso = isoDeDataBr(r.dataAgendada);
      out.set(key, {
        ...r,
        ultimaPosicao: '',
        // Rendered as-is (dd/mm/yyyy); the report carries no time.
        agendado: r.dataAgendada || '',
        agendadoOrdenavel: iso,
        futura: iso ? iso >= new Date().toISOString().slice(0, 10) : false,
      });
    });
    return out;
  }

  // Reads via the DataTables JS API (window.__sigcPro.readDataTable),
  // not raw DOM tr/td scraping: DataTables only renders the CURRENT
  // page's rows into the DOM (25/50/100 entries per page), so a raw
  // querySelectorAll('tbody tr') silently missed every Controle not on
  // the visible page (confirmed live, 2026-08-09). readDataTable() reads
  // the table's full dataset (rows().data()), all pages, same helper
  // csv-export.js already relies on for exactly this reason — see its
  // own comment for the F5-gateway DOM-scraping caveat this also avoids.
  // Which parser applies is the page's, not a guess: the two reports
  // share the #tableRelatorio id but not a single column name.
  function readUltimoMovimentoTable(modo) {
    const m = modo || modoAtual();
    const result = window.__sigcPro.readDataTable();
    if (!result) return null;
    return m.comDemanda
      ? biomarcadoresParaLinhas(result.header, result.rows)
      : parseUltimoMovimentoRows(result.header, result.rows);
  }

  // '*' is SIGC's "all" wildcard for a filtro field; a blank is the
  // select2 placeholder shape fetchAgenciaList already drops. Both mean
  // "not filtered by this field".
  const WILDCARD = '*';

  function isWildcard(v) {
    const s = String(v == null ? '' : v).trim();
    return s === '' || s === WILDCARD;
  }

  // The six filtro fields the Último Movimento form submits. Named
  // exactly as both the form inputs and the request body name them
  // (confirmed live 2026-08-14), so no translation table is needed
  // between reading them and sending them back.
  const FILTRO_FIELDS = [
    'IdUf', 'IdAgencia', 'IdMunicipio', 'Controle',
    'IdEntrevistadores', 'IdTipoAcompanhamento',
  ];

  // The whole filter the form currently holds, NOT just the agência.
  //
  // Primary source is #filtroJson, a hidden input where SIGC keeps the
  // filtro object it posts, already assembled (confirmed live
  // 2026-08-14). Reading it beats rebuilding the object from the six
  // individual selects: there is no chance of our reconstruction
  // disagreeing with what the server was actually given.
  //
  // Falls back to those individual inputs when #filtroJson is missing or
  // unparseable, so a page redesign that drops it degrades the feature
  // instead of killing it. Returns null only when neither source yields
  // a UF — the one field every scope needs.
  //
  // Never throws: this runs inside a capture-phase listener on SIGC's
  // own Filtrar button, where an exception would surface as the page's
  // bug, not ours.
  function lerFiltro() {
    const el = document.getElementById('filtroJson');
    if (el && String(el.value || '').trim()) {
      try {
        const parsed = JSON.parse(el.value);
        if (parsed && typeof parsed === 'object' && !isWildcard(parsed.IdUf)) return parsed;
      } catch (err) {
        console.warn(`${TAG} #filtroJson inválido, lendo os campos individuais:`, err);
      }
    }
    const out = {};
    FILTRO_FIELDS.forEach((f) => {
      const input = document.getElementById(f);
      // An absent field is "not filtered by this", i.e. the wildcard —
      // the same thing SIGC itself sends for an untouched filter. IdUf is
      // the exception: it names the UF every scope is relative to, so a
      // wildcard there is not a scope at all and must read as absent.
      const raw = input ? String(input.value || '').trim() : '';
      out[f] = raw || WILDCARD;
    });
    return isWildcard(out.IdUf) ? null : out;
  }

  // The filter the table ON SCREEN was actually rendered from, captured
  // when Filtrar is clicked. null when no Filtrar has happened yet in
  // this page's lifetime.
  //
  // Gating on this rather than on the live form is the whole point:
  // changing a dropdown does NOT re-run the report, so the rendered rows
  // still belong to the previously submitted filter. Gating on the live
  // form would scope the coordinate fetch to a filter whose data isn't
  // on screen — a silent wrong-data join, not a visible error.
  let filtroCapturado = null;

  function filtroAtual() {
    return filtroCapturado;
  }

  function captureFiltro() {
    filtroCapturado = lerFiltro();
  }

  // Test-only seam: the module-level capture survives between test
  // cases, so each one needs a clean starting point.
  function resetFiltroCapturado() {
    filtroCapturado = null;
    filtroAdotado = false;
  }

  // Filtrar is a plain form-action button that re-renders the table in
  // place, so there's no navigation or load event to hook — the click
  // itself is the signal. Capture on the CAPTURE phase so it records the
  // value even if the page's own handler stops propagation, and record
  // it before the request goes out (the selector can't change between
  // the click and the response).
  //
  // Bound once, lazily: btnFiltrar exists from page load on Último
  // Movimento, but this file also loads on pages without it.
  let filtrarBound = false;

  function bindFiltrarCapture() {
    if (filtrarBound) return;
    const btn = document.getElementById('btnFiltrar');
    if (!btn) return;
    btn.addEventListener('click', captureFiltro, true);
    filtrarBound = true;
  }

  // Seeds the captured filter from the form when a report is ALREADY
  // rendered but no Filtrar click was ever observed.
  //
  // Without this the button silently never appeared (reported live
  // 2026-08-10: "doesn't show up until a reload"). captureFiltro only
  // ever runs on a click, so any report that was on screen before this
  // file's listener existed — SIGC restoring filter state, a back
  // navigation, or simply a Filtrar during the extension's own startup
  // — left the capture empty for the page's whole lifetime. The
  // "reload" that appeared to fix it actually just gave the user a
  // reason to click Filtrar again.
  //
  // Safe because it's a one-time seed: once anything has been captured
  // it never overwrites, so a Filtrar-captured filter still wins over a
  // drifting form, which is the property the gate exists for.
  let filtroAdotado = false;

  function adoptRenderedFiltro(hasTable) {
    if (filtroAdotado || !hasTable) return;
    filtroAdotado = true;
    if (!filtroCapturado) filtroCapturado = lerFiltro();
  }

  // How many on-screen households the Lista de Endereços call returned
  // no entry for. Non-zero is not necessarily an error — a household can
  // legitimately lack coordinates — but a LARGE count after a
  // scope-matched fetch suggests a truncated or paginated response,
  // which would otherwise be indistinguishable from ordinary missing
  // geocoding once joinEnderecos folds both into temCoordenadas:false.
  // Distinguishes "some households lack geocoding" from "the two sides
  // did not join at all". A 100% miss against a NON-EMPTY response is not
  // a coverage gap: the keys disagree, or the two requests were scoped to
  // different populations. Same symptom, different cause, different fix —
  // and the example keys are what tell them apart in a bug report.
  function diagnosticoEnderecos(movimentoMap, enderecosMap) {
    const faltando = missingEnderecoCount(movimentoMap, enderecosMap);
    const primeira = (mapa) => {
      const it = mapa.keys().next();
      return it.done ? '' : it.value;
    };
    return {
      faltando,
      total: movimentoMap.size,
      todosFaltando: movimentoMap.size > 0 && faltando === movimentoMap.size,
      exemploRelatorio: primeira(movimentoMap),
      exemploEnderecos: primeira(enderecosMap),
    };
  }

  function missingEnderecoCount(movimentoMap, enderecosMap) {
    let missing = 0;
    movimentoMap.forEach((_row, key) => {
      if (!enderecosMap.has(key)) missing += 1;
    });
    return missing;
  }

  // Lista de Endereços cross-fetch — delegates entirely to
  // agenda-lookups.js's fetchEnderecosPorFiltro(filtro): ONE request
  // matching whatever scope the report on screen was filtered by,
  // replacing the per-Controle loop this used to make (one POST per
  // Controle on screen, dozens on a real report). The captured filter is
  // exactly what SIGC itself was given, so the server can scope the
  // coordinates identically — see motivoBloqueio for the scopes it
  // can't. This file never issues that request itself: the network call
  // stays inside agenda-lookups.js, the directory check-privacy.sh's
  // FETCH_DIRS already sanctions for it.
  async function onMapaClick(btn) {
    // The gated state is painted, not `disabled` (see pintarBloqueio), so
    // this handler DOES run when blocked — which is the point: the click
    // is what delivers the explanation on touch devices and to anyone who
    // never hovers. Checked first, and re-checked here rather than only at
    // mount, since a Filtrar can change the scope between the mount tick
    // and the click.
    const motivo = motivoBloqueio(filtroAtual());
    if (motivo) {
      alert(`SIGC-PRO: ${motivo}`);
      return;
    }
    ensureCss();
    // Resolved once, up front: it selects the parser for the table on
    // screen as well as everything downstream, so a single source of
    // truth beats asking the DOM again at each step.
    const modo = modoAtual();
    const movimentoMap = readUltimoMovimentoTable(modo);
    if (!movimentoMap || movimentoMap.size === 0) {
      alert('SIGC-PRO: nenhum dado encontrado no relatório — rode um Filtrar primeiro.');
      return;
    }
    // Preconditions are checked BEFORE the consent prompt: asking
    // permission for a request that then can't be made would train the
    // user to click through a prompt that didn't mean anything.
    const AM = window.__sigcProAgendaLookups;
    const filtro = filtroAtual();
    const uf = filtro.IdUf;

    if (!consentState.fetch) {
      if (!confirm(modo.comAgenda ? FETCH_CONSENT_MSG : FETCH_CONSENT_MSG_SEM_AGENDA)) return;
      consentState.fetch = true;
    }

    btn.disabled = true;
    try {
      // ONE call, whatever the scope: the captured filter is replayed
      // onto Lista de Endereços field-for-field, so the server scopes the
      // coordinates exactly the way it scoped the report on screen —
      // agência, município or Controle alike. Never a loop per Controle,
      // which for a município-wide report (a typical view) would be
      // dozens of POSTs.
      let enderecosMap = new Map();
      try {
        enderecosMap = await AM.fetchEnderecosPorFiltro(filtro);
      } catch (err) {
        console.warn(`${TAG} Lista de Endereços fetch failed:`, err);
        alert(`SIGC-PRO: não foi possível obter coordenadas (${err && err.message}); ` +
          'o mapa e a tabela de zonas serão exibidos sem coordenadas/zona.');
      }
      // A short response looks identical to ordinary missing geocoding
      // once joined, so say so rather than let it pass silently.
      const diag = diagnosticoEnderecos(movimentoMap, enderecosMap);
      if (enderecosMap.size > 0 && diag.faltando > 0) {
        console.warn(`${TAG} ${diag.faltando}/${diag.total} domicílio(s) sem entrada ` +
          `na Lista de Endereços. Exemplo relatório: "${diag.exemploRelatorio}" | ` +
          `exemplo endereços: "${diag.exemploEnderecos}" | ` +
          `endereços recebidos: ${enderecosMap.size}`);
        alert(diag.todosFaltando
          // Nothing matched at all: this is a join failure, not missing
          // geocoding, and telling the user "they have no address" would
          // send them looking in the wrong place.
          ? `SIGC-PRO: a Lista de Endereços respondeu ${enderecosMap.size} domicílio(s), ` +
            `mas nenhum corresponde aos ${diag.total} do relatório — as duas consultas ` +
            'parecem estar em recortes diferentes. O mapa sai sem coordenadas/zona. ' +
            '(Detalhes no console.)'
          : `SIGC-PRO: ${diag.faltando} de ${diag.total} domicílio(s) não retornaram ` +
            'endereço na consulta e ficarão sem coordenadas/zona.');
      }
      // The biomarcadores report has no Última Posição column, so without
      // this every household there looked equally untouched: the "Não
      // distribuída" column read 0 and all 1.416 blank-tipo households in
      // BA fell into "Outros". One extra request against the same scope
      // fills it in.
      //
      // Enrichment, so it fails soft: without it the split simply is not
      // available, which is exactly where the page stood before.
      if (modo.comDemanda) {
        try {
          const posicoes = await AM.fetchPosicoesPorFiltro(filtro);
          if (posicoes) {
            movimentoMap.forEach((r, key) => {
              const p = posicoes.get(key);
              if (!p) return;
              r.ultimaPosicao = p.ultimaPosicao;
              // The Entrevistadores tab buckets by this; same fetch,
              // one more column.
              r.entrevistador = p.entrevistador;
              // Only posição and entrevistador. tipoEntrevista is
              // deliberately NOT copied: where the biomarcadores report
              // leaves it blank,
              // Último Movimento says "Não Iniciada" for every one of
              // them (verified, BA: 1.416/1.416), so the fallback can
              // never promote a household into a real outcome — it only
              // moves it out of "Sem desfecho" into a column this page
              // does not render, where it would vanish from the status
              // counts while still counting toward Total.
            });
          }
        } catch (err) {
          console.warn(`${TAG} Último Movimento (posições) fetch failed:`, err);
        }
      }
      const joined = joinEnderecos(movimentoMap, enderecosMap, !modo.comDemanda);

      // The agenda is an enrichment, not the feature's core (that's the
      // coordinate join above) — a rejected agenda fetch must never cost
      // the map. Falls back to an empty index, leaving every `agendado`
      // blank, same fail-open shape as the Lista de Endereços fetch above.
      //
      // Skipped entirely in MODO_MOVIMENTO: that variant makes one request
      // and renders no agenda-derived column, so asking for the UF agenda
      // would be a request whose result is thrown away.
      let agendaIdx = new Map();
      let agendaSlots = [];
      // "Bookable now": from the first day still worth booking through
      // +17 days. Computed HERE, before the fetch, so the request itself
      // can be bounded by it — SIGC takes start/end as query parameters,
      // so a year-wide call was fetching the state's whole calendar to
      // keep about two weeks of it.
      //
      // Último Movimento still asks for the year: it joins bookings per
      // household, which can sit any time.
      const hojeParaJanela = new Date().toISOString().slice(0, 10);
      const minDateIso = primeiroDiaAgendavel(hojeParaJanela);
      const fimIso = fimDaJanela(hojeParaJanela);
      if (modo.comAgenda) {
        try {
          const ano = new Date().getFullYear();
          const agenda = modo.comDemanda
            ? await AM.fetchAgendaSlots(
              uf, `${minDateIso}T00:00:00`, `${fimIso}T23:59:59`)
            : await AM.fetchAgendaSlots(
              uf, `${ano}-01-01T00:00:00`, `${ano + 1}-01-01T00:00:00`);
          agendaSlots = agenda.dados || [];
          // Only Último Movimento needs the per-household index: on the
          // biomarcadores page every booking comes from the report's own
          // Data Agendada, so indexing thousands of slots by controle
          // would build a lookup joinAgenda can never use.
          if (!modo.comDemanda) agendaIdx = AM.indexByControle(agendaSlots);
        } catch (err) {
          console.warn(`${TAG} agenda fetch failed:`, err);
        }
      }
      const todayIso = new Date().toISOString().slice(0, 10);
      const comAgenda = joinAgenda(joined, agendaIdx, todayIso);

      pendingJoined = comAgenda;
      pendingModo = modo;
      const zonaRows = aggregateZonas(comAgenda, enderecosMap, modo, todayIso);

      // "Bookable now": from the first day still worth booking (see
      // primeiroDiaAgendavel — today and the next two days are dead
      // capacity) through +17 days. A slot months out would overstate the
      // capacity a zona actually has; a slot tomorrow overstates it too,
      // for the opposite reason.
      const slotsPorZona = new Map();
      zonaRows.forEach((z) => {
        const zonaKey = z.idZona || '';
        const livres = AM.slotsLivresDaJanela(agendaSlots, zonaKey, minDateIso, fimIso);
        slotsPorZona.set(zonaKey, AM.agruparPorDia(livres));
      });
      // Manhã/Tarde counts over that same window, from the function the
      // Agenda's own Slots Abertos panel uses — the 13:00 cut lives in
      // one place (TARDE_FROM_MIN) or the two features drift apart.
      const turnosPorZona = AM.indexZonaLivres(agendaSlots, minDateIso, fimIso);
      // Parked for the map, which renders after the tiles load — long
      // after this function has returned.
      pendingZonas = new Map(zonaRows.map((z) => [z.idZona || '', z]));
      pendingTurnos = turnosPorZona;
      pendingSlots = slotsPorZona;

      closePanel();
      document.body.insertAdjacentHTML('beforeend',
        buildPanelHtml(comAgenda, zonaRows, slotsPorZona, turnosPorZona, modo, todayIso));
      const panelEl = document.getElementById(PANEL_ID);
      wireTabs(panelEl, modo, {
        zonaRows, joined: comAgenda, filtro, hoje: todayIso,
      });
      wireZonaRowClicks(panelEl, comAgenda, modo);
      initPanelTables(panelEl);
      mapInitialized = false;
      maybeLoadTiles();
    } finally {
      btn.disabled = false;
    }
  }

  // Convex hull over zona domicílio coordinates (spec §2). Hand-rolled
  // Andrew's monotone chain — no new vendored dependency, matches this
  // repo's "vendor only what you must, hand-roll small pure logic"
  // approach (same rationale as zonaColor's own hash-based assignment).
  // points: Array<[lat, lon]>. Degenerate inputs (0/1/2 points, or all
  // collinear) never return an empty/broken polygon — every zona with
  // at least one valid-coordinate domicílio gets SOME shape (spec: "no
  // zona with points renders nothing").
  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  function convexHull(points) {
    // De-dup identical coordinates first — Andrew's monotone chain
    // assumes distinct points, and two identical rows (e.g. two
    // domicílios geocoded to the exact same address) must not count as
    // "2 points" for the polygon/capsule decision below.
    const uniq = [];
    const seen = new Set();
    points.forEach(([lat, lon]) => {
      const key = `${lat},${lon}`;
      if (!seen.has(key)) { seen.add(key); uniq.push([lat, lon]); }
    });

    if (uniq.length === 0) return null;
    if (uniq.length === 1) return { type: 'circle', center: uniq[0] };

    const sorted = [...uniq].sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));

    if (uniq.length === 2) {
      return { type: 'capsule', a: sorted[0], b: sorted[sorted.length - 1] };
    }

    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    const hull = lower.concat(upper);

    // All points collinear: the hull-building loop above collapses to
    // just the two extremes (lower/upper both degenerate) — treat the
    // same as the 2-point case rather than a degenerate "polygon" with
    // <3 vertices.
    if (hull.length < 3) {
      return { type: 'capsule', a: sorted[0], b: sorted[sorted.length - 1] };
    }
    return { type: 'polygon', points: hull };
  }

  // Controle label centroid + active/inactive/partial color rule (spec
  // §3). colorState is computed over EVERY row for that Controle
  // (including rows without valid coordinates) — it's a fact about
  // fieldwork progress, not about geocoding success. The centroid
  // average, separately, only uses rows with temCoordenadas (nothing
  // else to average otherwise). A Controle with zero valid-coordinate
  // rows gets no entry at all — there's no point to center a label on.
  function controleCentroids(joined) {
    const byControle = new Map(); // controle -> { coords: [[lat,lon],...], allDistribuido, noneDistribuido }
    joined.forEach((r) => {
      if (!byControle.has(r.controle)) {
        byControle.set(r.controle, { coords: [], allDistribuido: true, noneDistribuido: true });
      }
      const bucket = byControle.get(r.controle);
      if (r.temCoordenadas) bucket.coords.push([r.lat, r.lon]);
      const isDistribuido = r.ultimaPosicao === 'Distribuido';
      if (!isDistribuido) bucket.allDistribuido = false;
      if (isDistribuido) bucket.noneDistribuido = false;
    });

    const out = [];
    byControle.forEach((bucket, controle) => {
      if (bucket.coords.length === 0) return;
      const sums = bucket.coords.reduce((acc, [la, lo]) => [acc[0] + la, acc[1] + lo], [0, 0]);
      const lat = sums[0] / bucket.coords.length;
      const lon = sums[1] / bucket.coords.length;
      const colorState = bucket.allDistribuido ? 'inactive' : (bucket.noneDistribuido ? 'active' : 'partial');
      out.push({ controle, lat, lon, colorState });
    });
    return out;
  }

  const TITLE_MAPA_ATIVO = 'Mapa de domicílios por zona (SIGC-PRO)';

  // Why the Mapa can't run for the filter on screen, or '' when it can.
  //
  // ONE source of truth for both the hover tooltip and the click alert,
  // so the two can never drift apart — the reason the button explains
  // itself identically either way.
  //
  // Lista de Endereços accepts IdUf/IdAgencia/IdMunicipio/Controle, so
  // those four translate field-for-field into the coordinate lookup.
  //
  // The two Último Movimento-only fields (IdEntrevistadores,
  // IdTipoAcompanhamento) have no analogue there, but they are NOT
  // blocking on their own: they only narrow the report further WITHIN
  // whatever geographic scope is set. The coordinate response then covers
  // a superset of the rows on screen, and joinEnderecos' controle|
  // domicilio join discards the surplus — the same thing it already does
  // for any household with no endereços entry.
  //
  // What actually can't be served is a filter with NO geographic scope at
  // all: the coordinate request would fall back to the entire UF. So an
  // entrevistador filter alone is blocked (its implicit scope is the
  // whole state), while município+entrevistador is fine.
  function motivoBloqueio(filtro) {
    if (!filtro) {
      return 'Rode um Filtrar primeiro para o Mapa saber qual recorte buscar.';
    }
    if (isWildcard(filtro.IdUf)) {
      return 'Não foi possível identificar a UF atual.';
    }
    if (isWildcard(filtro.IdAgencia) && isWildcard(filtro.IdMunicipio) &&
        isWildcard(filtro.Controle)) {
      return 'Filtre por agência, município ou controle (e clique em Filtrar) ' +
        'para ver o mapa — um relatório de estado inteiro é grande demais ' +
        'para buscar coordenadas.';
    }
    return '';
  }

  // Button stays VISIBLE either way — an absent button is
  // indistinguishable from a broken extension, the same rule
  // lista-agenda.js states. Now that Último Movimento is the only home
  // for this feature, "the button disappeared" is a worse failure than
  // it was when Lista de Endereços still carried AGENDA PRO.
  //
  // Deliberately NOT btn.disabled: a disabled <button> swallows click
  // events, so the explanation could only ever be a hover tooltip —
  // invisible on touch, and easy to miss. Instead the button stays
  // clickable and is painted in the disabled colours (the same wash
  // paintDisabledState applies), with the click showing the reason. The
  // busy state during a fetch still uses real `disabled`, which is what
  // that flag should mean.
  const BLOQUEADO_ATTR = 'data-sigc-pro-bloqueado';

  function pintarBloqueio(btn, motivo) {
    btn.setAttribute('aria-disabled', motivo ? 'true' : 'false');
    if (motivo) btn.setAttribute(BLOQUEADO_ATTR, '1');
    else btn.removeAttribute(BLOQUEADO_ATTR);
    btn.style.background = motivo ? PRO_BLUE_BLOQUEADO : PRO_BLUE;
    btn.style.borderColor = motivo ? PRO_BLUE_BLOQUEADO : PRO_BLUE;
    btn.style.cursor = motivo ? 'help' : '';
    btn.title = motivo || TITLE_MAPA_ATIVO;
  }

  // Same pair sigc-common.js's paintDisabledState uses, repeated here
  // because this is the gated (not busy) state and must look identical.
  const PRO_BLUE = '#005a9c';
  const PRO_BLUE_BLOQUEADO = '#7fb3d3';

  function atualizarEstadoBotaoMapa() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    pintarBloqueio(btn, motivoBloqueio(filtroAtual()));
  }

  // Anchored to the DataTables toolbar (.dt-buttons), alongside CSV-pro
  // — not Filtrar/Cancelar — since Mapa needs the filtered table's rows
  // to do anything useful, same as CSV-pro itself; the toolbar only
  // exists once a Filtrar has actually rendered a table, so this button
  // (like CSV-pro) doesn't appear until then, unlike the earlier
  // Filtrar-anchored version which showed immediately with nothing to
  // act on yet.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.dtToolbar(),
    // Also requires that the report on screen was filtered by a single
    // agência — the captured Filtrar value, not the live dropdown, so
    // merely changing the selector doesn't flip the button's enabled
    // state while the old table is still displayed. Mapa's one
    // agência-scoped Lista de Endereços call can't cover a TODOS report,
    // so the button mounts disabled there rather than vanishing outright
    // — see atualizarEstadoBotaoMapa.
    //
    // The bind rides along on the mount tick: it's idempotent, and this
    // is already the one place guaranteed to run repeatedly on the page.
    when: () => {
      // Both hosts mount the same button; modoAtual() decides which
      // variant the click renders.
      if (!onUltimoMovimento() && !onBiomarcadores()) return false;
      bindFiltrarCapture();
      const hasTable = !!window.__sigcPro.getDataTable();
      adoptRenderedFiltro(hasTable);
      if (hasTable) atualizarEstadoBotaoMapa();
      return hasTable;
    },
    build: () => {
      const btn = window.__sigcPro.makeDtProButton({
        id: BUTTON_ID,
        // Every other makeDtProButton caller (KML-pro, CSV-pro, PDF-pro,
        // Agenda-pro) uses two lines — a single line left the text
        // sitting high/off-center in the box (confirmed visually), since
        // the button's vertical centering is tuned for two lines.
        lines: ['MAPA', 'PRO'],
        title: TITLE_MAPA_ATIVO,
        onClick: () => onMapaClick(btn),
      });
      // atualizarEstadoBotaoMapa() looks the button up by id in the DOM,
      // but build() runs BEFORE mountWidget inserts its return value —
      // set the initial state on btn directly instead of through that
      // lookup, or a freshly-mounted button would flash as enabled until
      // the next mount tick corrected it.
      pintarBloqueio(btn, motivoBloqueio(filtroAtual()));
      return btn;
    },
  });

  window.__sigcProUltimoMovimentoMapInternals = {
    parseUltimoMovimentoRows,
    joinEnderecos,
    joinAgenda,
    initPanelTables,
    colunasBatem,
    PANEL_PAGE_LENGTH,
    aggregateZonas,
    zonaColor,
    statusColor,
    raioPorZoom,
    agruparPorAgencia,
    classificaDomicilio,
    valeControleDeCamadas,
    corDaBorda,
    marcadorUrgente,
    renderLeafletMap,
    legendEntries,
    buildZonasTableHtml,
    buildEntrevistadoresTableHtml,
    GRUPO_ENTREVISTADOR,
    buildDomiciliosTabHtml,
    buildPopupHtml,
    buildZonaPopupHtml,
    focusZonaOnMap,
    focusDomicilioOnMap,
    setCurrentMapForTest,
    spiderfyRows,
    domicilioLabel,
    buildPanelHtml,
    buildEntendaHtml,
    onMapaClick,
    convexHull,
    controleCentroids,
    zonaRowIsClickable,
    isRealizadaSemAgendamento,
    isPendente,
    zonaSemCapacidade,
    onBiomarcadores,
    MODO_MOVIMENTO,
    MODO_BIOMARCADORES,
    coletaEmAberto,
    statusDesconhecido,
    isoDeDataBr,
    biomarcadoresParaLinhas,
    deveColeta,
    diasParaPrazo,
    emAlertaDePrazo,
    acaoDePrazo,
    agendavelDePrazo,
    PRAZO_ALERTA,
    modoAtual,
    tabelaParaCsv,
    wireTabs,
    nomeCsvAba,
    baixarCsvDaAba,
    recarregarSlots,
    primeiroDiaAgendavel,
    fimDaJanela,
    lerFiltro,
    filtroAtual,
    captureFiltro,
    resetFiltroCapturado,
    resetTileState,
    adoptRenderedFiltro,
    motivoBloqueio,
    isWildcard,
    missingEnderecoCount,
    diagnosticoEnderecos,
    atualizarEstadoBotaoMapa,
  };
})();
