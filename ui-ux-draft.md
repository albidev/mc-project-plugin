# Mission Control Projects Plugin — bozza UI/UX

**Stato:** proposta di composizione e interazioni
**Obiettivo UI:** un cockpit Git compatto per monitorare repository locali, remoti e PR GitHub senza replicare lazygit.

## 1. Principio di composizione

La schermata deve rispondere subito a quattro domande:

1. Quale progetto sto guardando?
2. Su quale branch sono?
3. Il branch locale è sincronizzato con il repository remoto?
4. Ci sono file modificati o PR aperte?

Il progetto selezionato e lo stato del branch hanno priorità visiva. Commit, working tree, PR e issue sono le superfici operative principali.

## 2. Layout desktop proposto

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Projects                                      [↻ Refresh] [⋯]         │
│ Repository locale e attività Git                                      │
├──────────────────────────────────────────────────────────────────────┤
│ [project selector: nome · owner/repo · stato · branch corrente  ˅]   │
├──────────────────────────────────────────────────────────────────────┤
│ [branch summary / remote topology]                                   │
│ local: feature-x   origin/feature-x   davide/project-fork             │
│ ahead 3 · behind 1       upstream: vendor/original-project            │
├──────────────────────────────┬───────────────────────────────────────┤
│ Commit timeline               │ Open pull requests · 3                │
│                              │ #42 Add project monitor       ›        │
│ ● HEAD feature-x             │ #39 Fix discovery boundary     ›        │
│ │  a81f2c4 · 18 min           │ #37 Improve mobile layout      ›        │
│ ● 4e90b1a · yesterday         │                                       │
│ ● c22a781 · 2 days            ├───────────────────────────────────────┤
│                              │ Working tree · 2 changed              │
│                              │ M src/.../loader.py                    │
│                              │ ? docs/projects.md                    │
├──────────────────────────────┴───────────────────────────────────────┤
│ Git tree  [▾ src] [▸ server] [▸ tests]                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Ordine dei pannelli

1. header e refresh;
2. selettore progetto;
3. riepilogo branch/remote;
4. working tree, branch e commit nella colonna sinistra;
5. pannello centrale contestuale nella colonna destra: diff file, log branch o dettaglio commit;
6. issue aperte e PR aperte affiancate nella fascia inferiore.

Il working tree non deve essere nascosto sotto le informazioni remote: è più importante per l’operatività immediata. Il pannello centrale deve reagire alla selezione senza cambiare layout.

## 3. Layout mobile proposto

```text
Projects                                      [↻]
[project selector                         ˅]

feature-x                         [ahead 3]
origin/feature-x · davide/project-fork
upstream/original-project         [behind 1]

Working tree · 2 changed
M  src/.../loader.py
?  docs/projects.md

Open PR · 3
#42 Add project monitor             [›]
#39 Fix discovery boundary          [›]

Commits
● a81f2c4  tighten plugin discovery
● 4e90b1a  polish workspace header

Open issues · 2
#18 Define project registry format
#15 Add remote divergence indicators
```

Su mobile:

- un solo scroll verticale del plugin;
- selettore sempre in alto;
- working tree prima di commit e dati remote;
- PR in lista compatta;
- dettaglio PR espandibile inline o in un pannello secondario;
- nessuna tab obbligatoria per raggiungere lo stato locale.

## 4. Selettore progetto

Usare lo stesso modello concettuale del selettore clienti Odoo:

- card unica del progetto selezionato;
- icona repository/progetto;
- nome leggibile;
- `owner/repository` come informazione secondaria;
- pill di stato (`Clean`, `2 changed`, `Unavailable`);
- pill del branch corrente;
- chevron;
- elenco verticale quando aperto;
- il progetto attivo non viene ripetuto nell’elenco;
- chiusura dopo la selezione.

Quando il catalogo è aperto, il resto della schermata può rimanere visibile: non serve replicare il comportamento Odoo di nascondere pannelli secondari, perché qui il selettore non deve diventare un flusso operativo dominante.

## 5. Riepilogo branch e remote topology

Il riepilogo deve essere una card informativa compatta, non un secondo selettore.

### Riga branch corrente

```text
⑂ feature-x     [current]
↳ origin/feature-x · davide/project-fork
↑ 3   ↓ 1        [diverged]
```

### Elenco branch

Ogni riga può mostrare:

- branch locale;
- indicatore current;
- remote di tracking;
- repository remoto;
- branch remoto;
- ahead/behind;
- stato no-upstream/stale.

Il repository remoto deve essere cliccabile per aprire GitHub, quando l’URL è valido. Il link apre una destinazione esterna e non modifica lo stato locale.

### Remote globali

Se esistono più remote, mostrarli in una sezione compatta:

```text
origin     davide/project-fork
upstream   vendor/original-project
```

Non dedurre visivamente che `origin` sia sempre il fork: usare il nome e l’URL reali.

## 6. Commit timeline

Nell’MVP usare una timeline compatta, non un grafo visuale completo.

Ogni commit mostra:

- nodo e linea verticale;
- hash abbreviato;
- subject;
- autore e tempo relativo;
- indicatori HEAD/branch/tag quando disponibili.

La timeline può essere filtrata o paginata in una fase successiva. Nessuna interazione di riscrittura della storia nel primo MVP.

## 7. Pull request aperte

Pannello con intestazione:

```text
Open pull requests                         [3]
```

### Riga chiusa

```text
#42  Add project monitor
     feature-x → main · davide/project-fork       [›]
```

La riga deve avere un target di almeno 44px e indicare chiaramente che è espandibile.

### Riga espansa

```text
#42  Add project monitor                         [⌃]
     feature-x → main
     davide/project-fork → vendor/original-project

     Descrizione della pull request...
     Davide · opened 2 days ago
     [3 checks] [enhancement] [1 reviewer]
     [Open on GitHub]
```

Il dettaglio viene caricato soltanto all’espansione. Durante il caricamento la riga conserva numero e titolo. Un errore del dettaglio mostra un messaggio inline e non chiude la lista.

## 8. Working tree

Il working tree deve essere sempre facilmente raggiungibile.

### Stati

- `Clean` verde e poco invasivo;
- `2 changed` giallo;
- `Conflict` rosso;
- `Unavailable` rosso/giallo solo nel pannello interessato.

### Riga file

```text
M  src/plugins/loader.py                 +12 −3
?  docs/projects.md                      untracked
D  src/legacy.py                         deleted
```

Nell’MVP il file è consultabile come elemento Git, ma non si apre una preview. La preview è fase 2.

## 9. Issue aperte

Il pannello issue mostra soltanto informazioni remote utili al monitoraggio.

- numero e titolo sempre visibili;
- label e data in forma compatta quando disponibili;
- link diretto alla issue su GitHub;
- nessuna creazione, modifica o chiusura issue nel MVP;
- stato indisponibile isolato nel pannello GitHub.

## 10. Azioni

### Sempre disponibili

- selezione progetto;
- refresh manuale;
- apertura repository GitHub;
- apertura PR su GitHub.

### Azioni branch

- switch branch;
- create branch;
- create + checkout automatico.

Il cambio branch con working tree sporco deve essere bloccato nel MVP con messaggio chiaro. Nessuno stash automatico.

Le azioni mutanti devono usare conferma inline/modal compatta e mostrare lo stato `in progress`, `success` o `failed`.

## 11. Refresh e stati

Il refresh è un’azione globale del progetto:

```text
[↻ Refresh]
```

Durante il refresh:

- l’ultimo snapshot resta visibile;
- il pulsante viene disabilitato o mostra spinner;
- si mostra `Refreshing…` vicino a `Last updated`;
- le sezioni possono aggiornarsi senza lampeggiare;
- un errore GitHub resta nel pannello PR/remote;
- un errore Git locale mostra il problema senza smontare il selettore.

Non usare polling automatico nell’MVP.

## 12. Linguaggio visivo

Riutilizzare le convenzioni già presenti in Mission Control:

- superfici `surface-raised` e `surface-sunken`;
- bordi `border`/`border-border-subtle` sottili;
- accent viola per selezione e azioni primarie;
- `Badge`/pills per stato, branch e conteggi;
- icone Lucide;
- bordi arrotondati coerenti con `var(--control-radius)`;
- titoli piccoli e gerarchia tipografica compatta;
- colori positive/warning/negative solo per stato;
- toolbar orizzontale compatta, scrollabile su viewport stretti.

Evitare:

- estetica terminale pura;
- enormi cards decorative;
- doppie liste dello stesso dato;
- checkbox per azioni che non sono selezioni;
- pannelli bianchi o separatori pesanti;
- badge testuali ridondanti (`Installed`, `Branch`, `Status`) quando icona e contesto bastano.

## 13. Stati da progettare

- nessun progetto configurato;
- caricamento iniziale;
- progetto pulito;
- progetto con modifiche;
- branch senza upstream;
- fork con `origin` e `upstream`;
- branch ahead/behind/diverged;
- remote stale;
- PR aperte;
- nessuna PR aperta;
- dettaglio PR in caricamento;
- GitHub non autenticato/non disponibile;
- creazione branch riuscita/fallita;
- cambio branch bloccato per working tree sporco;
- git tree vuoto o non disponibile.

## 14. Decisioni UI/UX già prese

- preview file: fase 2;
- commit: timeline compatta;
- nuovo branch: create + checkout;
- dettaglio PR: caricamento all’espansione;
- refresh: manuale;
- mobile: layout a colonna con working tree prima del git tree.

## 15. Prossimo passo consigliato

Prima di scrivere componenti, produrre una sola wireframe visuale dell’MVP con:

- stato pulito;
- stato con fork `origin`/`upstream` e ahead/behind;
- una PR chiusa e una espansa;
- working tree modificato;
- stato GitHub non disponibile.

Il wireframe serve a verificare la densità e la gerarchia. Non serve ancora definire colori pixel-perfect o componenti backend.
