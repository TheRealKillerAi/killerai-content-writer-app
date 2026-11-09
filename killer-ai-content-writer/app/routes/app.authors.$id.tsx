import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { authorFromForm, getAuthor, saveAuthor } from "../lib/authors.server";
import { loadEffectiveSettings, loadSettings, saveSettings } from "../lib/settings.server";
import { pickedImage } from "../lib/files.server";
import { chatJson, LlmError } from "../lib/pipeline/llm.server";
import personaPrompt from "../lib/pipeline/prompts/persona.md?raw";
import { useFilePicker } from "../components/useFilePicker";

const BLANK = { kind: "real", name: "", jobTitle: "", bio: "", profileUrl: "", photoUrl: "", photoAlt: "", voice: "" };
type Fields = typeof BLANK;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (params.id === "new") return { id: "", author: BLANK, isDefault: false };
  const a = await getAuthor(session.shop, params.id!);
  if (!a) throw redirect("/app/authors");
  const s = await loadSettings(session.shop);
  const { id, kind, name, jobTitle, bio, profileUrl, photoUrl, photoAlt, voice } = a;
  return { id, author: { kind, name, jobTitle, bio, profileUrl, photoUrl, photoAlt, voice }, isDefault: s.defaultAuthorId === id };
};

type Result = { persona?: Partial<Fields>; image?: { url: string; alt: string }; error?: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<Result | Response> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "file-url") {
    try {
      return { image: await pickedImage(admin, JSON.parse(String(form.get("ids")))) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "We couldn't use that picture." };
    }
  }

  if (intent === "persona") {
    const brief = String(form.get("brief") ?? "").trim().slice(0, 600);
    const s = await loadEffectiveSettings(admin, session.shop);
    const context = [
      s.businessName && `Store: ${s.businessName}`,
      s.whatYouSell && `Sells: ${s.whatYouSell}`,
      s.audience && `Customers: ${s.audience}`,
      s.brandDescription && `Store voice: ${s.brandDescription}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const { json } = await chatJson<Partial<Fields>>(personaPrompt, `STORE\n${context || "(no details given)"}\n\nOWNER'S BRIEF\n${brief || "(none: choose something that suits the store)"}`, {
        temperature: 0.8,
      });
      if (!json.name) return { error: "We couldn't build a persona this time. Please try again." };
      return { persona: { name: json.name, jobTitle: json.jobTitle ?? "", bio: json.bio ?? "", voice: json.voice ?? "" } };
    } catch (e) {
      return { error: e instanceof LlmError ? e.message : "Something went wrong. Please try again." };
    }
  }

  // save
  const input = authorFromForm(form);
  if (!input.name) return { error: "Please give the author a name." };
  const saved = await saveAuthor(session.shop, params.id === "new" ? null : params.id!, input);
  if (form.get("makeDefault") === "1") {
    const s = await loadSettings(session.shop);
    await saveSettings(session.shop, { ...s, defaultAuthorId: saved.id });
  }
  return redirect("/app/authors");
};

const val = (e: Event) => (e.currentTarget as unknown as { value: string }).value;

export default function EditAuthor() {
  const { id, author, isDefault } = useLoaderData<typeof loader>();
  const [f, setF] = useState<Fields>(author);
  const [brief, setBrief] = useState("");
  const [version, setVersion] = useState(0); // remounts fields after the persona builder fills them
  const [makeDefault, setMakeDefault] = useState(isDefault);
  const saveF = useFetcher<Result>();
  const buildF = useFetcher<Result>();
  const set = (patch: Partial<Fields>) => setF((p) => ({ ...p, ...patch }));
  const picker = useFilePicker((p) => set({ photoUrl: p.url, photoAlt: p.alt }));
  const persona = f.kind === "persona";
  const built = buildF.data;

  const apply = () => {
    if (!built?.persona) return;
    set({ ...built.persona });
    setVersion((v) => v + 1);
  };

  const save = () => {
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    fd.set("intent", "save");
    if (makeDefault) fd.set("makeDefault", "1");
    saveF.submit(fd, { method: "POST" });
  };

  return (
    <s-page heading={id ? "Edit author" : "Add author"}>
      <s-button slot="breadcrumb-actions" href="/app/authors">Authors</s-button>
      <s-button slot="primary-action" variant="primary" onClick={save} {...(saveF.state !== "idle" ? { loading: true } : {})}>
        Save author
      </s-button>

      {saveF.data?.error ? <s-banner tone="critical">{saveF.data.error}</s-banner> : null}

      <s-section heading="Type of author">
        <s-stack direction="block" gap="base">
          <s-choice-list
            label="Who is this author?"
            labelAccessibilityVisibility="exclusive"
            onChange={(e) => set({ kind: (val(e as unknown as Event) as string) === "persona" ? "persona" : "real" })}
          >
            <s-choice value="real" selected={!persona}>A real person (enter their actual details)</s-choice>
            <s-choice value="persona" selected={persona}>An AI persona (an invented author avatar)</s-choice>
          </s-choice-list>
          {persona ? (
            <s-banner tone="info">
              A persona is a made-up author. Your readers will see the name and bio below, so only keep details that are
              true to your store. We never invent qualifications, years of experience or personal stories for a persona.
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      {persona ? (
        <s-section heading="Build a persona">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Describe the kind of author you'd like, or leave it blank and we'll suggest one that suits your store. You can
              change anything afterwards.
            </s-paragraph>
            <s-text-area
              label="Your brief (optional)"
              details="For example: a friendly, practical writer who loves explaining things simply."
              rows={3}
              value={brief}
              onInput={(e) => setBrief(val(e as unknown as Event))}
            />
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-button
                {...(buildF.state !== "idle" ? { loading: true } : {})}
                onClick={() => buildF.submit({ intent: "persona", brief }, { method: "POST" })}
              >
                Build persona
              </s-button>
              <s-text color="subdued">Nothing is saved until you save the author.</s-text>
            </s-stack>
            {built?.error ? <s-banner tone="warning">{built.error}</s-banner> : null}
            {built?.persona ? (
              <s-banner tone="success" heading={`Meet ${built.persona.name}`}>
                <s-paragraph>{[built.persona.jobTitle, built.persona.bio].filter(Boolean).join(". ")}</s-paragraph>
                <s-stack direction="inline">
                  <s-button onClick={apply}>Use this persona</s-button>
                </s-stack>
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Details">
        <s-stack direction="block" gap="base" key={version}>
          <s-text-field label="Name" value={f.name} onInput={(e) => set({ name: val(e as unknown as Event) })} />
          <s-text-field
            label="Job title"
            details='For example "Writer" or "Founder". Optional.'
            value={f.jobTitle}
            onInput={(e) => set({ jobTitle: val(e as unknown as Event) })}
          />
          <s-text-area
            label="Short bio"
            details="Shown in the About the author box if you turn it on in Settings. Keep it true."
            rows={3}
            value={f.bio}
            onInput={(e) => set({ bio: val(e as unknown as Event) })}
          />
          <s-text-field
            label="Profile link"
            details="Optional. A web address, for example their LinkedIn or About page."
            value={f.profileUrl}
            onInput={(e) => set({ profileUrl: val(e as unknown as Event) })}
          />
          <s-text-area
            label="Writing style notes"
            details="Optional. How this author writes. These layer on top of your brand voice, and never add facts."
            rows={4}
            value={f.voice}
            onInput={(e) => set({ voice: val(e as unknown as Event) })}
          />
        </s-stack>
      </s-section>

      <s-section heading="Photo">
        <s-stack direction="block" gap="base">
          {f.photoUrl ? <s-thumbnail src={f.photoUrl} alt={f.photoAlt || f.name || "Author photo"} size="large" /> : null}
          <s-stack direction="inline" gap="small">
            <s-button onClick={picker.pick} {...(picker.busy ? { loading: true } : {})}>
              {f.photoUrl ? "Change photo" : "Choose photo"}
            </s-button>
            {f.photoUrl ? <s-button variant="tertiary" onClick={() => set({ photoUrl: "", photoAlt: "" })}>Remove</s-button> : null}
          </s-stack>
          {picker.error ? <s-banner tone="warning">{picker.error}</s-banner> : null}
        </s-stack>
      </s-section>

      <s-section heading="Default author">
        <s-checkbox
          label="Use this author for new articles"
          checked={makeDefault}
          onChange={(e) => setMakeDefault((e.currentTarget as unknown as { checked: boolean }).checked)}
        />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
