# Prompt — Resumo de roteiros a partir do Guia do Dia

From the SIGC-PRO "Guia do Dia" HTML file at <PATH>, produce a roteiro summary.

Format:

    DATA: DD/MM/AA <Dia-da-Semana>

    Roteiro N (<equipe curta>) <Turno>:
    Agência <nome(s)>
    Responsável/Motorista:
    Horário no laboratório:
    Coletas: <horários separados por vírgula>

Rules:

- Read the per-team panels (one `<section>` per equipe), not the summary grid.
- Equipe short name: strip the `29_Linus_` prefix (29_Linus_Pituba_1 → Pituba 1).
- Split each equipe into Manhã (< 13h) and Tarde (>= 13h). An equipe with
  visits in both turnos becomes two roteiros.
- Order roteiros: Manhã before Tarde; within a turno, by equipe name
  (Pituba 1, Pituba 2, Lauro 2 — i.e. Pituba before Lauro, numeric ascending).
- Agência: from the "Agência:" field on the cards; render as
  SALVADOR 1 → Salvador I, SALVADOR 2 → Salvador II, CAMACARI → Camaçari.
  List all distinct agências of that roteiro, joined with " e ".
- Coletas: start times of each card, in ascending order, rounded down to the
  scheduled slot and written Brazilian-style (8h30, 9h, 10h40). 10:01 → 10h,
  10:41 → 10h40, 11:21 → 11h20.
- Leave "Responsável/Motorista" and "Horário no laboratório" blank — the guia
  does not contain them.
- Output plain text only, no commentary.
