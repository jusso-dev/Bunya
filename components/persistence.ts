import { toast } from "sonner";
import { deserialiseFromFragment, isShareFragment, loadStoredDocument, saveToLocalStorage, type StoredLoad } from "@/lib/graph/serialise";
import { FX_RATE_STORAGE_KEY, useGraphStore } from "@/lib/session/store";
import { buildOrganisationRulesEnvelope, parseOrganisationRulesText, type OrganisationRule } from "@/lib/rules/organisation";
import { useSessionUi } from "@/lib/session/ui";

const ORGANISATION_RULES_STORAGE_KEY = "bunya.organisationRules";
const SAVE_DELAY_MS = 250;

const STORED_LOAD_NOTICE: Partial<Record<StoredLoad["status"], () => void>> = {
  recovered: () => toast.warning("Your last change could not be loaded, so Bunya restored the previous saved version of this diagram.", { id: "storage-recovery" }),
  unreadable: () => toast.error("Your saved diagram could not be loaded. It has been kept in this browser; import a recent export to continue.", { id: "storage-recovery", duration: Infinity }),
};

// Storage that throws (private or restricted browsers) reads as empty; the
// failed document save then tells the user their work is not being kept.
function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveDocument(): void {
  useSessionUi.getState().setSaveFailed(!saveToLocalStorage(useGraphStore.getState().document));
}

function saveOrganisationRules(rules: OrganisationRule[]): void {
  try { localStorage.setItem(ORGANISATION_RULES_STORAGE_KEY, JSON.stringify(buildOrganisationRulesEnvelope(rules))); }
  catch { toast.error("Rules could not be saved. Export them to keep your changes.", { id: "rules-save" }); }
}

// Shows a shared link if the URL carries one, else the diagram saved in this
// browser, and restores the saved exchange rate and organisation rules.
// Returns false when unreadable local storage must be left untouched until the
// user explicitly edits or imports a diagram.
async function restore(isStopped: () => boolean): Promise<boolean> {
  const graph = useGraphStore.getState();
  const initialDocument = graph.document;
  const fragment = window.location.hash.slice(1);
  const isShareLink = isShareFragment(fragment);
  const shared = isShareLink ? await deserialiseFromFragment(fragment) : null;
  if (isStopped()) return false;
  let shouldSaveInitial = true;
  if (useGraphStore.getState().document === initialDocument) {
    const stored = loadStoredDocument();
    if (shared) {
      graph.reset(shared);
    } else {
      if (isShareLink) toast.warning("Shared diagram is invalid or too large. Restored your saved diagram.");
      if (stored.status === "ok" || stored.status === "recovered") graph.reset(stored.document);
      if (stored.status === "unreadable") shouldSaveInitial = false;
      STORED_LOAD_NOTICE[stored.status]?.();
    }
    useSessionUi.getState().requestFit();
  }

  const fx = Number(readStorage(FX_RATE_STORAGE_KEY));
  if (Number.isFinite(fx) && fx > 0) graph.setFxAudPerUsd(fx);

  const rules = readStorage(ORGANISATION_RULES_STORAGE_KEY);
  if (rules) {
    const parsed = parseOrganisationRulesText(rules);
    if (parsed.ok) graph.replaceOrganisationRules(parsed.rules);
    else toast.warning("Saved organisation rules could not be loaded.", { id: "rules-load" });
  }
  return shouldSaveInitial;
}

function debounce(run: () => void): { schedule: () => void; cancel: () => void } {
  let timer: number | undefined;
  return {
    schedule: () => { window.clearTimeout(timer); timer = window.setTimeout(run, SAVE_DELAY_MS); },
    cancel: () => window.clearTimeout(timer),
  };
}

// Restores the session, then saves the diagram and organisation rules shortly
// after each change. Returns a function that stops saving.
export function startPersistence(): () => void {
  let stopped = false;
  const document = debounce(saveDocument);
  const rules = debounce(() => saveOrganisationRules(useGraphStore.getState().organisationRules));
  const unsubscribe = useGraphStore.subscribe((state, previous) => {
    if (state.document !== previous.document) document.schedule();
    if (state.organisationRules !== previous.organisationRules) rules.schedule();
  });
  void restore(() => stopped)
    .then((shouldSaveInitial) => {
      // Save once even when nothing changed, so blocked storage is reported
      // straight away — unless unreadable data is being preserved in storage.
      if (!stopped && shouldSaveInitial) document.schedule();
    })
    .catch((error) => {
      console.error("Bunya could not restore the saved session:", error);
      if (!stopped) document.schedule();
    });
  return () => {
    stopped = true;
    unsubscribe();
    document.cancel();
    rules.cancel();
  };
}
