// SIGC-PRO feature: annotates the Lista de Endereços (selecionados view)
// with data the page itself does not carry — each household's scheduled
// interview and collection status, plus how many slots remain bookable
// in its zonas.
//
// Two sources, both same-origin and behind one click+confirm:
//   Agenda          GET  AdministracaoAgenda/ObterSlots  (JSON)
//   Último Movimento POST /relatorio/filtrar             (HTML fragment)
// Both key on (Controle, Domicílio), the table's own key.
//
// Three seams — acquire / index / render — so the fetches stay
// independent (either may fail without costing the other's columns) and
// every decision worth testing lives in a pure function.
//
// Spec: docs/superpowers/specs/2026-07-31-lista-agenda-design.md
(function () {
  'use strict';

  // --- index (pure) ---------------------------------------------------

  // The agenda response carries name, sex, birth date, address and
  // telephone per slot. Keep ONLY what the annotations need, so no richer
  // object is ever held in memory or reachable from a later change.
  function parseSlots(json) {
    if (!Array.isArray(json)) return [];
    return json.map((s) => {
      const f = window.__sigcPro.parseAgendaSlotTitle(s && s.title);
      const start = String((s && s.start) || '');
      return {
        start,
        isoDate: start.slice(0, 10),
        controle: f['Controle'] || '',
        domicilio: f['Domicílio'] || '',
        zonas: f['Zonas'] || '',
        // An open slot's title is only "Zonas: …" — no Controle line,
        // since nothing is assigned yet. The JSON has no CSS class to
        // read, so this IS the open test.
        aberto: !f['Controle'],
      };
    });
  }

  // "29JDM8 - 29.2.01.02 29_Linus_Lauro" -> "29JDM8", the same ID Zona
  // the table carries in column 18. Entries without the separator key on
  // themselves rather than being dropped.
  function zonaIdOf(entry) {
    const s = String(entry ?? '').trim();
    const i = s.indexOf(' - ');
    return i === -1 ? s : s.slice(0, i).trim();
  }

  const chaveDomicilio = (controle, domicilio) => `${controle}|${domicilio}`;

  function indexByControle(slots) {
    const map = new Map();
    slots.forEach((s) => {
      if (s.aberto || !s.controle) return;
      const k = chaveDomicilio(s.controle, s.domicilio);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    });
    return map;
  }

  // Free = open AND on/after the prazo mínimo. A slot before the cutoff
  // cannot be filled anymore, so counting it would advertise capacity
  // that does not exist.
  function indexZonaLivres(slots, minDateIso) {
    const map = new Map();
    slots.forEach((s) => {
      if (!s.aberto) return;
      if (s.isoDate && s.isoDate < minDateIso) return;
      const ids = new Set(
        window.__sigcPro.parseZonaEntries(s.zonas).map(zonaIdOf).filter(Boolean));
      if (ids.size === 0) return;
      const peso = 1 / ids.size;
      ids.forEach((id) => {
        if (!map.has(id)) map.set(id, { inteiro: 0, peso: 0, compartilhado: false });
        const cell = map.get(id);
        cell.inteiro += 1;
        cell.peso += peso;
        if (ids.size > 1) cell.compartilhado = true;
      });
    });
    return map;
  }

  // Only one schedule is live at a time, so a future date wins outright;
  // otherwise show the most recent past one, flagged so a completed
  // interview does not read as an upcoming appointment.
  function pickAgendado(slots, todayIso) {
    if (!slots || slots.length === 0) return null;
    const ordenado = [...slots].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    const futura = ordenado.find((s) => s.isoDate >= todayIso);
    const escolhido = futura || ordenado[ordenado.length - 1];
    return {
      data: window.__sigcPro.isoToBr(escolhido.isoDate),
      futura: !!futura,
    };
  }

  window.__sigcPro.listaAgenda = {
    parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado,
  };
})();
