# MC Project Plugin — requisiti consolidati

**Stato:** DRAFT per revisione
**Plugin tecnico:** `mc-project-plugin`
**Nome visualizzato:** `Projects`

## 1. Obiettivo

Mission Control deve offrire un monitor compatto dei progetti Git, con informazioni locali del checkout, topologia dei remote GitHub, commit, working tree, pull request e issue.

Il plugin non deve diventare un IDE o una copia completa di lazygit.

## 2. Layout frontend approvato

```text
┌──────────────────────┬──────────────────────────────────┐
│ Project selector     │                                  │
│ Files                │       Context panel              │
│ Branch topology      │       (diff / branch log /        │
│ Commits              │        commit detail)             │
│                      ├──────────────────┬───────────────┤
│                      │ Open issues      │ Open PR        │
└──────────────────────┴──────────────────┴───────────────┘
```

- layout full width;
- sidebar sinistra con quattro sezioni verticali;
- pannello centrale/destra dominante;
- issue e PR sotto il pannello centrale, affiancate;
- root del plugin con un solo scroll verticale affidabile;
- su mobile: una colonna con ordine deterministico.

## 3. Project selector

- card compatta del progetto selezionato;
- nome progetto e `owner/repository`;
- stato working tree e branch corrente;
- elenco verticale apribile, senza duplicare il progetto attivo;
- selezione → aggiornamento dello snapshot e chiusura elenco;
- nessun path locale esposto nella UI se non in forma sicura/abbreviata.

## 4. Files / working tree

- albero gerarchico, non lista piatta;
- directory espandibili/collassabili;
- righe compatte stile VS Code;
- icone piccole e indentazione moderata;
- stati inline `M`, `A`, `D`, `??`;
- conteggio modifiche sulle directory;
- selezione a riga intera;
- click file → pannello centrale in modalità diff;
- preview/apertura del file rimandata alla fase 2.

## 5. Branch topology

Due tab compatte:

- **Local:** branch locali, branch corrente, tracking branch, ahead/behind, no-upstream;
- **Remote:** remote alias, branch remoto, repository GitHub e stato remoto.

Devono essere supportati casi con:

```text
origin   → fork dell’utente
upstream → repository originale
```

Click branch → pannello centrale in modalità branch log.

## 6. Commit timeline

- mostra i commit del branch attivo/selezionato;
- timeline testuale compatta con `●`, `│`, `├─` e decorazioni ref;
- hash abbreviato, subject, autore e data;
- merge commit riconoscibili;
- click commit → dettaglio commit nel pannello centrale.

Non serve un grafo SVG/canvas nell’MVP.

## 7. Pannello centrale contestuale

Il pannello mantiene posizione e dimensione, ma cambia contenuto:

### File selezionato

- diff `Working tree ↔ HEAD`;
- diff unified;
- righe aggiunte/rimosse/context;
- header con path file;
- scrolling interno verticale/orizzontale.

### Branch selezionato

- log del branch;
- grafo testuale;
- commit, ref, autore e data;
- scrolling interno.

### Commit selezionato

- hash completo/abbreviato;
- titolo, autore, data e ref;
- statistiche file/insertions/deletions;
- lista file modificati;
- diff del commit;
- scrolling interno.

## 8. Pull request aperte

- GitHub API come fonte primaria;
- mostrare solo PR aperte del repository associato;
- riga minima: numero, titolo, URL e draft/open;
- branch head/base e repository fork quando disponibili;
- click/espansione → descrizione, autore, labels, reviewer, assignee, checks e date;
- dettaglio caricabile on demand;
- errore dettaglio isolato alla singola PR/pannello.

## 9. Issue aperte

- GitHub API come fonte primaria;
- lista di issue aperte;
- minimo: numero, titolo, data e URL;
- nessuna creazione, modifica o chiusura nell’MVP;
- errori GitHub isolati dal monitor Git locale.

## 10. Refresh

- pulsante manuale;
- aggiorna Git locale, branch/remotes, ahead/behind, commit, working tree e GitHub/PR/issue;
- non esegue `fetch`, `pull`, `push` o altre mutation;
- conserva l’ultimo snapshot valido durante il caricamento;
- mostra `lastUpdated` e stato `refreshing`;
- niente polling automatico nell’MVP.

## 11. Backend plugin

Struttura prevista:

```text
manifest.json
endpoints.py
handlers.py / service.py
registry.py
repository_context.py
command_runner.py
git_commands/
loaders/
refresh.py
github_adapter.py
models.py
errors.py
ui/
tests/
```

- `endpoints.py`: adapter HTTP sottile;
- registry: progetti autorizzati e path verificati;
- Git locale: subprocess allowlistati, `shell=False`, cwd fissata, timeout e output limitato;
- GitHub: adapter separato per repository, branch remoti, PR, issue e checks;
- snapshot: aggregato per la UI, composto da loader distinti;
- errori: codici stabili, redatti e per-capability.

## 12. Mutation branch

MVP:

- switch branch locale;
- create branch locale dal branch corrente;
- checkout automatico sul nuovo branch;
- blocco con working tree sporco;
- nessuno stash automatico;
- validazione branch name;
- lock per progetto;
- read-back di HEAD e working tree;
- nessun comando arbitrario dal browser.

## 13. Registry

- configurazione locale esplicita;
- ogni progetto ha `id`, nome, path, remote e default branch;
- il browser invia solo `project_id` e valori strettamente validati;
- containment/symlink check prima di ogni lettura o mutation;
- nessun token GitHub nel registry.

## 14. Fuori MVP

- preview file;
- grafo visuale avanzato;
- staging per hunk;
- commit dal plugin;
- push/pull/fetch automatici;
- merge/rebase/reset/revert/cherry-pick;
- mutation GitHub;
- gestione issue/PR;
- CI/CD e terminale integrato.

## 15. Criteri di accettazione frontend

- route esterna caricata tramite loader generico MC;
- layout full width e responsive;
- Files mantiene albero e selezione;
- tab Local/Remote funzionanti;
- click file/branch/commit cambia il pannello centrale;
- diff/log/dettaglio scrollabili;
- Issue e PR affiancate sotto il pannello centrale;
- stati loading/empty/error isolati;
- type-check, test UI e host build verificati.

## 16. Criteri di accettazione backend

- manifest e handler allineati;
- catalogo e snapshot autenticati;
- registry non manipolabile dal client;
- parsing Git testato con fixture per rename, unicode, spazi, merge e conflitti;
- GitHub PR/issue con fallback e stato stale/unavailable;
- timeout, output cap, redaction e mapping errori;
- mutation branch validate, lockate e verificate con read-back;
- contratto reale `/api/local` testato end-to-end.
