# Mission Control Projects Plugin — bozza requisiti

**Stato:** bozza di discussione
**Obiettivo:** monitorare rapidamente progetti GitHub e svolgere poche operazioni Git essenziali, senza trasformare Mission Control in un IDE o in una copia di lazygit.

## 1. Obiettivo del plugin

Il plugin aggiunge a Mission Control uno spazio **Projects** dove l’utente può:

- scegliere un progetto da un selettore unico;
- vedere il repository GitHub associato;
- controllare branch, commit e stato locale;
- svolgere piccole operazioni Git a basso attrito;
- mantenere una lettura compatta, grafica e coerente con Mission Control.

Il plugin deve essere orientato prima al **monitoraggio**, poi alle operazioni.

## 2. Concetto di progetto

Ogni progetto configurato contiene almeno:

- nome visualizzato;
- repository locale associato;
- repository remoto GitHub;
- branch principale/predefinito;
- stato di disponibilità del repository;
- ultimo aggiornamento rilevato.

Il progetto selezionato deve rimanere evidente in tutta la schermata, come avviene per il selettore clienti del plugin Odoo.

### Stati minimi del progetto

- **Disponibile** — repository locale e remoto riconosciuti;
- **Modificato** — esistono file non committati;
- **In conflitto** — repository in stato di merge/rebase conflittuale;
- **Non disponibile** — repository locale o remoto non accessibile;
- **In caricamento** — dati Git ancora in lettura.

Non inventare dati mancanti: mostrare uno stato esplicito e un messaggio breve.

## 3. Selettore progetto

Il selettore deve seguire il pattern del selettore clienti Odoo:

- una sola card compatta per il progetto attivo;
- nome progetto e repository GitHub ben visibili;
- stato sintetico tramite dot, icona e pill;
- branch corrente mostrato nella card;
- chevron per aprire/chiudere l’elenco;
- elenco verticale dei progetti disponibili;
- il progetto attivo non viene duplicato nell’elenco aperto;
- selezione di un progetto → aggiornamento della card e chiusura dell’elenco;
- nessuna griglia permanente di progetti;
- ricerca solo se il numero di progetti lo rende necessario.

## 4. Schermata principale

La schermata deve avere una gerarchia chiara, con pochi pannelli:

1. **Header del progetto**
   - nome progetto;
   - repository GitHub;
   - branch corrente;
   - stato del working tree;
   - azioni rapide essenziali.

2. **Riepilogo Git**
   - branch corrente e branch locali;
   - remote di tracking di ogni branch;
   - repository remoto associato a ogni branch (`origin`, `upstream`, fork, repository originale);
   - branch remoto seguito;
   - ahead/behind rispetto al tracking branch;
   - indicazione di branch senza upstream o con dati remoti non aggiornati;
   - numero di file modificati/non tracciati;
   - ultimo commit.

3. **Attività recente**
   - lista degli ultimi commit;
   - hash abbreviato;
   - autore;
   - messaggio;
   - data/tempo relativo;
   - branch o ref quando utile.

Il pannello centrale deve cambiare contenuto in base alla selezione effettuata nella colonna sinistra:

- click su un file → diff del file tra working tree e HEAD;
- click su un branch → log/timeline del branch, con decorazioni dei ref e commit collegati;
- click su un commit → dettaglio del commit, statistiche, lista dei file coinvolti e relativo diff.

Il pannello centrale deve occupare tutta l’area assegnata e avere scrolling interno per diff, log e dettaglio commit lunghi.

4. **Working tree**
   - file modificati;
   - file aggiunti/non tracciati;
   - file rimossi;
   - stato sintetico per file;
   - conteggio modifiche, se disponibile.

5. **Working tree ad albero**
   - struttura compatta tipo Files/Explorer;
   - directory espandibili/collassabili;
   - stati Git direttamente sulle righe (`M`, `A`, `D`, `??`);
   - selezione della riga e scrolling;
   - selezione di un file per visualizzarne il diff;
   - preview/apertura del contenuto del file rimandata alla fase 2.

6. **Pull request aperte**
   - mostrare solo le PR aperte del repository GitHub associato;
   - visualizzare almeno numero e titolo;
   - rendere la riga espandibile;
   - caricare all’espansione il dettaglio e mostrare, quando disponibile, descrizione, autore, branch head/base, repository del fork, labels, reviewers, assignees, checks e date;
   - mantenere valida la riga minima anche quando il dettaglio non è disponibile.

7. **Issue aperte**
   - mostrare il numero delle issue aperte;
   - visualizzare almeno numero e titolo;
   - aprire la issue su GitHub;
   - nessuna creazione, modifica o chiusura issue nel MVP.

Il grafo dei commit e la lista dei file non committati devono essere distinguibili visivamente: il primo è storico/temporale, il secondo è stato locale corrente.

## 5. Operazioni indispensabili

### Branch

- cambiare branch locale;
- creare un nuovo branch a partire dal branch corrente e fare checkout automatico sul nuovo branch;
- mostrare il branch corrente in modo persistente;
- impedire operazioni ambigue quando il working tree è sporco, con avviso chiaro;
- aggiornare il riepilogo dopo l’operazione.

### Monitoraggio

- pulsante di refresh manuale;
- il refresh aggiorna Git locale, relazioni con i remote, ahead/behind e dati GitHub/PR;
- mostrare l’istante dell’ultimo aggiornamento;
- mantenere l’ultimo stato valido mentre il refresh è in corso;
- nessun polling automatico nel MVP;
- nessun fetch automatico durante il refresh;
- rilevazione di modifiche locali;
- visualizzazione ahead/behind quando il remoto è raggiungibile;
- indicazione quando i remote-tracking refs locali possono essere stale;
- visualizzazione di errori Git senza sostituire l’intera schermata con un errore globale.

### Pull request e dati GitHub

- GitHub API obbligatoria per l’elenco delle PR aperte e per i dettagli remoti;
- il backend deve identificare correttamente repository originale, fork e repository head della PR;
- l’assenza o l’indisponibilità temporanea dell’autenticazione GitHub non deve nascondere lo stato Git locale;
- gli errori GitHub devono rimanere confinati al pannello remoto;
- il dettaglio esteso della PR viene caricato all’espansione della riga.

### Operazioni escluse dalla prima bozza

Non includere inizialmente:

- staging interattivo per hunk o singole righe;
- commit dal plugin;
- push e pull;
- merge e rebase;
- cherry-pick, reset e revert;
- creazione, modifica o chiusura delle issue;
- creazione, modifica, merge o chiusura delle pull request;
- editor di file;
- terminale integrato;
- visualizzazione completa delle diff inline;
- automazioni CI/CD.

Queste funzioni possono essere valutate in seguito, ma non fanno parte del nucleo iniziale.

## 6. Direzione grafica

Il plugin deve sembrare nativo di Mission Control, non una schermata Git separata.

### Principi

- tema scuro e palette già usata da Mission Control;
- pannelli charcoal con bordi sottili e poco contrastati;
- accento viola per selezione, azioni primarie e branch attivo;
- verde per stato pulito/successo;
- giallo per modifiche locali o attenzione;
- rosso solo per conflitti/errori;
- icone compatte, preferibilmente Lucide/icone già esposte dall’host;
- pills per branch, stato, conteggi e ahead/behind;
- niente grandi bordi bianchi o separatori aggressivi;
- densità informativa medio-alta, ma con gerarchia leggibile;
- azioni secondarie nascoste in menu o quick actions, non tutte sempre esposte.

### Layout

- desktop: selettore e contesto progetto in alto/lato, contenuti Git in pannelli affiancati;
- mobile: una colonna, selettore in cima, commit e working tree prima del git tree;
- un solo scroll principale del plugin;
- target interattivi sufficientemente grandi anche su mobile;
- nessun pannello secondario deve nascondere il progetto selezionato o lo stato del working tree.

## 7. Comportamento e stati UI

La prima versione deve prevedere almeno:

- caricamento iniziale;
- progetto senza modifiche;
- progetto con file modificati;
- nessun progetto configurato;
- repository non raggiungibile;
- branch non disponibile;
- conflitto Git;
- creazione branch riuscita;
- errore durante cambio/creazione branch;
- refresh in corso senza cancellare l’ultimo stato valido.

Gli errori di una capacità opzionale devono rimanere confinati al relativo pannello. Un problema del git tree, per esempio, non deve far sparire selettore, branch e working tree.

## 8. Confini tecnici da confermare

- Il frontend non deve eseguire comandi Git direttamente.
- Il backend del plugin deve essere l’unico confine verso i repository locali e GitHub.
- Le operazioni mutanti devono essere allowlistate, validate e seguite da read-back dello stato Git.
- I path dei repository devono provenire dalla configurazione autorizzata del plugin, non dalla richiesta libera del browser.
- Il plugin deve riusare il contratto esterno di Mission Control (`manifest.json`, `endpoints.py`, `ui/`) e il trasporto `/api/local`.
- Non modificare il core di Mission Control per implementare il plugin.

## 9. MVP proposto

Per la prima iterazione limiterei il perimetro a:

1. selettore progetto;
2. card di contesto con repository, branch e stato;
3. lista commit recenti;
4. lista working tree e diff del file selezionato;
5. working tree ad albero compatto;
6. pannello centrale contestuale per file, branch e commit;
7. diff del file selezionato;
8. log testuale del branch selezionato;
9. dettaglio del commit selezionato con file coinvolti e diff;
10. cambio branch;
11. creazione branch con checkout automatico;
12. relazione branch → remote → repository GitHub;
13. ahead/behind e stato stale/no-upstream;
14. elenco delle PR aperte con numero/titolo e dettaglio espandibile;
15. elenco delle issue aperte con numero/titolo;
16. refresh manuale e gestione degli stati di errore;
17. layout responsive coerente con Mission Control.

**Posizione:** niente commit/push nel primo MVP. Il plugin deve prima dimostrare di essere un ottimo monitor Git con due operazioni semplici, non diventare un altro client Git completo.

## 10. Punti da decidere insieme

- I progetti vengono definiti in un file di configurazione, rilevati da una cartella, o registrati dalla UI?
- Il cambio branch richiede una conferma quando ci sono modifiche locali?
- Quali limiti operativi sono appropriati dopo aver osservato il numero reale di progetti e file?

### Decisioni già prese

- preview/apertura dei file nel git tree: **fase 2**;
- rappresentazione dei commit: **timeline compatta nell’MVP**;
- creazione branch: **crea e fa checkout automaticamente**;
- dettaglio PR: **caricamento all’espansione**;
- scala supportata: **da osservare prima di fissare limiti di prodotto**.
