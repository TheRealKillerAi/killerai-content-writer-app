import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

type Picked = { url: string; alt: string };
type Intents = { invoke: (name: string, opts?: unknown) => Promise<{ complete: Promise<{ code: string; data?: { ids?: string[] } }> }> };

/** Opens Shopify's own file picker and hands back the chosen picture's address. */
export function useFilePicker(onPicked: (p: Picked) => void) {
  const f = useFetcher<{ image?: Picked; error?: string }>();
  const [error, setError] = useState("");
  const cb = useRef(onPicked);
  cb.current = onPicked;
  const waiting = useRef(false);

  useEffect(() => {
    if (!waiting.current || !f.data) return;
    waiting.current = false;
    if (f.data.error) setError(f.data.error);
    else if (f.data.image) cb.current(f.data.image);
  }, [f.data]);

  const pick = async () => {
    setError("");
    try {
      const intents = (window as unknown as { shopify?: { intents?: Intents } }).shopify?.intents;
      if (!intents) return setError("Shopify's picture picker isn't available here. Please reload the app and try again.");
      const activity = await intents.invoke("pick:shopify/File", { data: { mediaTypes: ["MediaImage"], multiSelect: false } });
      const res = await activity.complete;
      if (res.code !== "ok" || !res.data?.ids?.length) return;
      waiting.current = true;
      f.submit({ intent: "file-url", ids: JSON.stringify(res.data.ids) }, { method: "POST" });
    } catch {
      setError("We couldn't open your Shopify files. Please try again.");
    }
  };
  return { pick, busy: f.state !== "idle", error };
}
