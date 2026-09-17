# Mission Control Projects Plugin — bozza architettura backend

**Stato:** proposta per discussione
**Decisione architetturale proposta:** backend Python plugin-owned, registry esplicito dei progetti, Git CLI come adapter controllato, API aggregate per snapshot coerenti.

## 1. Decisione in una frase

Il plugin non deve diventare un servizio Git autonomo: Mission Control invia richieste al backend del plugin, il backend risolve un progetto da un registry autorizzato, coordina l’adapter Git locale e l’adapter GitHub, e restituisce un modello JSON già adatto alla UI.

```text
Mission Control UI
        │  /api/local/projects/...
        ▼
Mission Control Plugin Loader
        ▼
projects-plugin/endpoints.py        HTTP adapter
        ▼
projects-plugin/service.py           orchestration + validation
        ├── registry.py                progetto → path/repository configurato
        ├── git_adapter.py             subprocess Git controllato
        ├── github_adapter.py           remote metadata + collaborazione
        └── models.py                  envelope e tipi di risposta
```

Il frontend non conosce path locali, non costruisce argv e non invoca `git` o GitHub direttamente.

## 2. Perché questa architettura

### Cosa prendiamo realmente da lazygit

L’architettura non deve avere un generico `run_git(args)` né un unico modulo che conosce ogni parte del repository. lazygit separa il contesto del repository, i comandi specializzati, i loader dei modelli e il refresh dei pannelli:

```text
RepositoryContext
├── fixed repo directory + Git environment
├── CommandRunner
├── BranchCommands
├── CommitCommands
├── WorkingTreeCommands
├── StatusCommands
├── RemoteCommands
└── Loaders
    ├── BranchLoader
    ├── CommitLoader
    ├── FileLoader
    └── RemoteLoader
```

Per il plugin la traduzione minima è:

- `repository_context.py` fissa il progetto risolto dal registry;
- `command_runner.py` applica timeout, `shell=False`, cwd, environment e limiti output;
- `git_commands/` contiene operazioni nominate per dominio;
- `loaders/` converte output Git in modelli tipizzati;
- `refresh.py` decide quali loader rieseguire dopo una mutation;
- `service.py` compone i modelli per l’endpoint, ma non costruisce direttamente gli argv.

Lo snapshot HTTP può restare aggregato per comodità della UI, ma internamente deve essere ottenuto da loader distinti. Dopo `switch_branch`, per esempio, non si deve rileggere solo il branch: vanno invalidati almeno HEAD, log, status, working tree e divergence.

La fonte di verità dipende dal dato:

| Dato                                         | Fonte primaria | Motivo                                                                              |
| -------------------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| working tree, file modificati, branch locali | Git locale     | GitHub non conosce le modifiche non committate e i branch locali.                   |
| HEAD e log presenti nel checkout             | Git locale     | È lo stato effettivamente osservato sul repository aperto.                          |
| branch remoti, PR, issue, checks, release    | GitHub API     | Sono informazioni del servizio remoto e non devono essere ricostruite dal checkout. |
| tracking branch e remote alias               | Git locale     | Il checkout contiene la relazione branch → remote/ref configurata localmente.       |
| ahead/behind rispetto al tracking branch     | Git locale     | È la divergenza effettiva rispetto al ref upstream osservato.                       |
| stato aggiornato del repository remoto       | GitHub API     | Git locale può avere remote-tracking refs vecchi se non viene eseguito fetch.       |

Il backend deve quindi comporre due fonti, dichiarando nella risposta quale sezione è `local`, quale è `github` e quando un dato remoto è stale o non disponibile.

### Requisito chiarito: relazione branch ↔ repository remoto

La lista dei branch non deve mostrare soltanto il nome locale. Deve spiegare a quale repository remoto è collegato ogni branch e qual è la sua divergenza. Questo è importante per fork e repository di terze parti, dove un checkout può avere, per esempio:

```text
upstream → github.com/vendor/original-project
origin   → github.com/davide/original-project

local branch: feature-x
tracking:     origin/feature-x
relation:     ahead 3 · behind 1
```

Per ogni branch locale il modello deve poter esporre almeno:

- nome locale e indicazione del branch corrente;
- remote di tracking e nome del branch remoto seguito;
- nome e URL del repository remoto;
- ahead/behind rispetto al tracking branch;
- stato `no-upstream` quando non segue alcun remoto;
- stato `stale` o `unavailable` quando il dato remoto non è aggiornato/disponibile.

Il backend deve leggere i remote dal repository locale e usare GitHub per arricchire/validare il repository remoto. Non bisogna assumere che `origin` sia il fork o che `upstream` esista: sono alias configurabili del repository.

### Requisito chiarito: pull request aperte

La schermata deve mostrare esclusivamente le **pull request aperte** del repository GitHub associato al progetto.

Il livello minimo per ogni PR è:

- numero;
- titolo;
- URL;
- stato draft quando disponibile;
- branch head e branch base quando disponibili.

La riga deve poter essere espansa. Nel dettaglio, quando disponibile, mostrare descrizione, autore, repository e branch head inclusi i fork, repository e branch base, labels, reviewers/assignees, checks, data di apertura e ultimo aggiornamento. Se il dettaglio non è disponibile, numero e titolo restano comunque validi. Il fallimento del dettaglio di una PR non deve bloccare branch o stato locale.

### Scelta consigliata: Git CLI controllata

**Pro:**

- usa la stessa semantica Git già presente sul sistema;
- evita di reimplementare graph, ref, status e tree;
- nessuna dipendenza Python pesante per il primo MVP;
- funziona anche con repository GitHub privati già autenticati tramite SSH/credential helper;
- rende semplice mantenere le operazioni in sola lettura, salvo endpoint espliciti.

**Contro:**

- bisogna gestire timeout, encoding, exit code e repository corrotti;
- l’output Git non è una API tipizzata, quindi va parsato in modo robusto;
- la disponibilità dipende dal binario Git e dal checkout locale.

### Alternative scartate per ora

| Alternativa                                        | Valutazione                                                                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GitPython`/libreria equivalente                   | Più API Python, ma aggiunge dipendenza e non elimina la necessità di gestire repository/path/errori. Da rivalutare solo se il parsing CLI diventa il problema reale. |
| API GitHub come fonte primaria di tutto            | Sbagliata per il monitoraggio locale: non vede working tree e branch non pubblicati. Va usata come adapter remoto secondario, non come sostituto di Git locale.      |
| daemon Git permanente                              | Complessità e stato duplicato senza beneficio per un monitor di piccole operazioni.                                                                                  |
| esecuzione di comandi generici passati dal browser | Non accettabile: trasforma il plugin in un terminale remoto con path e comandi arbitrari.                                                                            |

## 3. Registry dei progetti

La fonte dei progetti deve essere un **registry esplicito e autorizzato**, non una scansione automatica della home o una lista derivata da GitHub.

Esempio concettuale:

```json
{
  "projects": [
    {
      "id": "mission-control",
      "name": "Mission Control",
      "path": "${MC_PROJECT_HOST_ROOT}",
      "remote": "https://github.com/example/mission-control-host.git",
      "defaultBranch": "main",
      "enabled": true
    }
  ]
}
```

### Regole del registry

- `id` è lo stable identifier usato dalle API, non il path;
- `path` viene letto dal file di configurazione del plugin e non accettato dal browser;
- il path deve essere assoluto, esistente, directory e repository Git valido;
- eventuali symlink devono essere risolti e verificati dentro le root approvate;
- `remote` è metadata verificato dal backend, non un URL arbitrario per eseguire clone;
- il registry non esegue clone, pull o fetch automaticamente;
- un progetto non disponibile resta visibile con stato `unavailable`, se il registry è valido;
- la configurazione non deve contenere token GitHub.

### Dove salvare il registry

**Proposta MVP:** file di configurazione esplicito fuori dal repository del plugin, con path indicato da una variabile d’ambiente o da una posizione standard del profilo Hermes.

Motivo: i progetti sono dati locali dell’installazione, non codice versionato del plugin. Il plugin può fornire un file `.example`, ma non deve creare o modificare automaticamente la configurazione reale.

## 4. Struttura del plugin

```text
mc-projects-plugin/
├── manifest.json
├── endpoints.py          # parsing HTTP e traduzione degli errori
├── service.py            # use case e orchestrazione
├── registry.py           # caricamento + validazione progetto
├── repository_context.py # cwd/env/identità del repository risolto
├── command_runner.py     # runner unico con timeout e limiti
├── git_commands/         # branch, commits, files, status, tree, remote
├── loaders/              # parsing e modelli per area
├── refresh.py            # invalidazione/refresh per area
├── github_adapter.py     # remote metadata + collaborazione
├── models.py             # TypedDict/dataclass del contratto
├── errors.py             # errori pubblici controllati
├── config.py             # risoluzione config e limiti
├── ui/
└── tests/
```

`endpoints.py` resta sottile. La logica Git non deve finire negli handler HTTP.

Non è necessario replicare tutta la complessità di lazygit: niente staging, rebase, stash, diff interattive o worktree nell’MVP. Va replicato il principio di separazione, non l’intero prodotto.

## 5. Contratto API proposto

Tutti i path sono relativi a `/api/local`, quindi l’endpoint reale è, per esempio, `/api/local/projects/snapshot`.

### 5.1 Catalogo progetti

```http
GET /projects/catalog
```

Risposta:

```json
{
  "projects": [
    {
      "id": "mission-control",
      "name": "Mission Control",
      "repository": "example/mission-control-host",
      "pathLabel": "${MC_PROJECT_HOST_ROOT}",
      "available": true,
      "currentBranch": "main",
      "workingTree": { "state": "clean", "changed": 0, "untracked": 0 },
      "lastCheckedAt": "..."
    }
  ]
}
```

Il backend può restituire un catalogo sintetico. Non deve eseguire tutte le letture costose per ogni progetto se il numero cresce; può usare una fase di validazione leggera.

### 5.2 Snapshot selezionato

```http
GET /projects/snapshot?project=mission-control
```

Questo è l’endpoint principale della schermata. Restituisce un modello coerente raccolto nella stessa lettura:

```json
{
  "project": {
    "id": "mission-control",
    "name": "Mission Control",
    "repository": "example/mission-control-host",
    "remoteUrl": "https://github.com/example/mission-control-host.git",
    "available": true
  },
  "head": {
    "branch": "main",
    "commit": "a81f2c4",
    "subject": "tighten plugin discovery boundary",
    "ahead": 0,
    "behind": 0
  },
  "workingTree": {
    "state": "modified",
    "files": [{ "path": "src/plugins/loader.py", "status": "modified", "staged": false }],
    "counts": { "modified": 1, "added": 0, "deleted": 0, "untracked": 0 }
  },
  "commits": [],
  "branches": [],
  "tree": {},
  "capabilities": {
    "switchBranch": true,
    "createBranch": true,
    "githubLink": true
  },
  "warnings": []
}
```

### Regola di coerenza

Lo snapshot deve essere costruito dal backend come una singola lettura applicativa, con un `snapshotId` o `observedAt` comune. Le sezioni devono riferirsi allo stesso progetto e allo stesso HEAD osservato.

Se una sezione secondaria fallisce, non cancellare tutto lo snapshot:

```json
{
  "tree": { "state": "unavailable", "error": { "code": "GIT_TREE_FAILED" } },
  "warnings": ["git tree unavailable"]
}
```

Il frontend deve poter mostrare progetto, branch e working tree anche se il tree è indisponibile.

### 5.3 Refresh

Non serve un endpoint dedicato: il pulsante **Refresh** ripete `GET /projects/snapshot`.

Nel MVP il refresh è manuale e aggiorna, in un’unica azione applicativa:

- stato Git locale;
- branch, tracking e ahead/behind;
- commit recenti;
- working tree;
- tree quando necessario;
- repository remoto e pull request aperte tramite GitHub.

Il refresh non esegue `fetch`, `pull` o altre mutation. Non serve polling automatico né un watcher filesystem permanente nel MVP. La risposta deve includere `observedAt`/`lastUpdated`; durante il caricamento la UI conserva l’ultimo snapshot valido e mostra lo stato `refreshing`.

### 5.4 Cambio branch

```http
POST /projects/branch/switch?project=mission-control
Content-Type: application/json

{"branch": "feat/project-plugin", "force": false}
```

Regole:

- body strict: solo `branch` e, se deciso, `force` sempre rifiutato nel MVP;
- il branch deve corrispondere a un ref locale già presente;
- nessun branch remoto viene creato o scaricato implicitamente;
- se il working tree è sporco, rispondere `409 PRECONDITION_FAILED`;
- eseguire `git switch -- <branch>`? No: per cambiare branch usare l’argv corretto `git switch <validated-branch>`, senza shell;
- dopo l’operazione rileggere HEAD e working tree;
- successo solo se il read-back conferma il branch richiesto;
- in caso di esito incerto, non dichiarare successo.

Risposta di successo:

```json
{
  "ok": true,
  "operation": "switch_branch",
  "project": "mission-control",
  "branch": "feat/project-plugin",
  "verified": true,
  "snapshot": {}
}
```

### 5.5 Creazione branch

```http
POST /projects/branch/create?project=mission-control
Content-Type: application/json

{"branch": "feat/project-plugin"}
```

Regole:

- nome branch validato con `git check-ref-format --branch` oppure equivalente sicuro;
- rifiutare branch già esistente;
- creare dal HEAD corrente;
- non fare checkout automatico senza una decisione esplicita. **Proposta:** creare e passare al nuovo branch, perché è l’aspettativa tipica di lazygit; va confermato;
- rileggere branch e HEAD dopo la mutazione;
- lock per progetto per impedire due operazioni simultanee.

## 6. Adapter Git

L’adapter deve offrire metodi piccoli e tipizzati, non una funzione `run_git(args)` esposta al resto del plugin senza vincoli:

```text
read_head(project)
read_status(project)
read_log(project, limit)
read_branches(project)
read_tree(project, path, depth)
read_remote(project)
switch_branch(project, branch)
create_branch(project, branch)
```

Internamente ogni comando deve avere:

- `shell=False`;
- cwd derivata dal registry;
- argv costruito dal codice, mai dal browser;
- timeout numerico;
- limite su stdout/stderr;
- encoding UTF-8 con gestione esplicita degli errori;
- exit code tradotto in errore pubblico non sensibile;
- log senza path completi, token o output arbitrario;
- cleanup garantito del processo.

### Comandi read-only indicativi

- `git status --porcelain=v1 -uall`;
- `git branch --format=...`;
- `git log ...` con limite massimo;
- `git rev-parse --abbrev-ref HEAD`;
- `git rev-list --left-right --count HEAD...@{upstream}` quando l’upstream esiste;
- `git ls-tree` per il tree;
- `git remote get-url origin` per il remote.

Il formato esatto va fissato durante l’implementazione e coperto da fixture reali, soprattutto per nomi file con spazi, unicode, rename e caratteri speciali.

## 7. GitHub adapter

GitHub deve essere previsto nell’architettura, ma con un confine separato dall’adapter Git locale.

### Primo incremento consigliato

L’adapter GitHub può fornire:

- repository canonicale e URL web;
- default branch remoto;
- stato di visibilità e disponibilità del repository;
- branch remoti rilevanti;
- ultimi commit remoti;
- pull request aperte associate al repository;
- checks/status dell’ultimo commit, quando disponibili.

Queste informazioni sono additive: se GitHub non è raggiungibile, la schermata deve continuare a mostrare working tree, branch locali e commit locali.

### Cosa non deve fare l’adapter GitHub nel primo MVP

- clone del repository;
- fetch, pull o push;
- creazione/cancellazione di branch remoti;
- merge o chiusura di pull request;
- gestione generalizzata di token nel browser.

Le mutation GitHub possono arrivare in seguito, ma devono avere endpoint e autorizzazioni propri, distinti dalle mutation locali.

### Autenticazione

Il token GitHub non deve transitare nel frontend e non deve essere salvato nel registry dei progetti. L’adapter deve usare una credenziale già configurata nell’ambiente locale oppure un credential store/integrazione GitHub esplicitamente definita.

La scelta concreta tra GitHub App, token personale e `gh` credential store è una decisione separata. Per l’MVP è sufficiente definire un’interfaccia `GitHubCredentialsProvider` e rendere GitHub una capability opzionale.

### Rate limit e cache

Le chiamate GitHub non devono essere eseguite a ogni render o a ogni refresh locale indipendente. Il backend deve:

- usare cache in memoria con TTL per metadata remoti;
- rispettare `ETag`/`If-None-Match` quando l’endpoint lo consente;
- separare refresh locale rapido da refresh remoto più lento;
- restituire `source`, `observedAt` e `stale` per i dati remoti;
- mostrare rate limit/errori GitHub nel solo pannello remoto.

Il modello corretto è quindi **local-first, GitHub-enriched**, non **local-only**.

## 8. Errori pubblici

Gli errori devono avere forma stabile:

```json
{
  "error": {
    "code": "WORKTREE_DIRTY",
    "message": "Il branch non può essere cambiato perché ci sono modifiche locali.",
    "retryable": false
  }
}
```

Codici iniziali:

- `PROJECT_NOT_FOUND` — 404;
- `PROJECT_UNAVAILABLE` — 503;
- `NOT_A_REPOSITORY` — 409;
- `GIT_NOT_INSTALLED` — 503;
- `GIT_TIMEOUT` — 504;
- `GIT_OUTPUT_INVALID` — 502;
- `WORKTREE_DIRTY` — 409;
- `BRANCH_NOT_FOUND` — 404;
- `BRANCH_ALREADY_EXISTS` — 409;
- `INVALID_BRANCH_NAME` — 400;
- `OPERATION_IN_PROGRESS` — 409;
- `READBACK_MISMATCH` — 409.

Non restituire traceback, argv completo, environment, token o path sensibili non necessari.

## 9. Concorrenza e cache

**Proposta MVP:** nessuna cache persistente del Git state.

- ogni snapshot legge lo stato attuale;
- cache in memoria opzionale e brevissima solo per evitare richieste duplicate ravvicinate;
- dopo una mutation la cache viene invalidata;
- lock per `project_id` sulle operazioni di branch;
- le letture concorrenti possono continuare, ma uno snapshot vecchio deve essere marcato come tale se il backend aggiunge cache/polling.

Non usare browser persistence come fonte della verità Git.

## 10. Configurazione e sicurezza

- solo progetti presenti nel registry possono essere selezionati;
- nessun path, executable, env o argv dal client;
- il backend usa l’autenticazione fornita dall’host Mission Control;
- tutti gli endpoint richiedono autenticazione;
- le mutation hanno endpoint separati e body strict;
- repository root e symlink vengono verificati prima di ogni operazione;
- i comandi sono terminati entro deadline;
- il plugin non modifica file di configurazione Git e non gestisce credenziali;
- accesso GitHub e SSH restano responsabilità dell’ambiente locale.

## 11. Test backend indispensabili

### Registry

- config valida;
- progetto inesistente;
- path fuori root consentita;
- symlink escape;
- directory non Git;
- duplicate ID;
- remote mancante o non parsabile.

### Adapter Git

- repository pulito;
- file modificati, non tracciati, aggiunti e rimossi;
- branch corrente e branch senza upstream;
- commit limitato;
- tree con directory annidate;
- filename con spazi/unicode;
- Git assente, timeout e output malformato.

### Mutation

- autenticazione;
- branch invalido;
- branch inesistente;
- branch già esistente;
- working tree sporco;
- lock/seconda richiesta;
- read-back riuscito;
- read-back fallito;
- nessun comando arbitrario accettato dal body.

### Contratto host

- manifest/handler allineati;
- shape JSON visibile all’host;
- errori serializzati correttamente;
- snapshot parziale con warning;
- plugin installato senza GitHub token;
- UI con backend vuoto, errore e progetto non disponibile.

## 12. Decisioni da prendere prima di implementare

1. **Registry:** file statico configurato manualmente oppure UI di registrazione?
   Proposta: file statico nel MVP.
2. **Root consentite:** una lista di root approvate oppure ogni path esplicito?
   Proposta: path esplicito + containment nelle root configurate.
3. **Creazione branch:** crea soltanto oppure crea e fa checkout?
   Decisione: crea e fa checkout.
4. **Working tree sporco:** blocco sempre il cambio branch oppure dialogo con opzioni?
   Proposta: blocco sempre; niente `stash` automatico.
5. **Git tree:** tutto il repository o caricamento lazy per directory?
   Proposta: directory lazy, con limite profondità/entry.
6. **Commit graph:** vero grafo visuale già nell’MVP oppure lista con indicatori di ref?
   Decisione: lista/timeline con indicatori; vero grafo in una fase successiva.
7. **Aggiornamento dati:** polling automatico oppure pulsante manuale?
   Decisione: pulsante manuale che aggiorna Git locale e GitHub, senza fetch.
8. **Fetch remoto:** nessun fetch automatico o refresh remoto esplicito?
   Proposta: nessun fetch nel primo MVP.

## 13. Confine MVP risultante

Il backend MVP dovrebbe implementare soltanto:

- caricamento e validazione registry;
- catalogo sintetico;
- snapshot coerente del progetto selezionato;
- lettura branch, log, status e tree;
- switch branch locale;
- create branch locale con checkout automatico;
- relazione branch locale → remote → repository GitHub;
- ahead/behind e stato stale/no-upstream;
- elenco PR aperte con numero/titolo e dettagli caricati all’espansione;
- errori tipizzati, timeout, lock e read-back;
- metadata GitHub e link al repository derivati dal remote locale.

Tutto il resto è fuori perimetro finché questo flusso non è verificato end-to-end attraverso `/api/local` e la UI reale del plugin.
