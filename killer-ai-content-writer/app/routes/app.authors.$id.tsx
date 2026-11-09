import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { authorFromForm, getAuthor, listAuthors, saveAuthor } from "../lib/authors.server";
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
    const pick = (k: string, allowed: string[]) => (allowed.includes(String(form.get(k))) ? String(form.get(k)) : "any");
    const gender = pick("gender", ["woman", "man", "non-binary"]);
    const age = pick("age", ["20s", "30s", "40s", "50s", "60s+"]);
    const style = String(form.get("style") ?? "").trim().slice(0, 120);
    const brief = String(form.get("brief") ?? "").trim().slice(0, 600);
    const existing = (await listAuthors(session.shop))
      .filter((a) => a.id !== params.id)
      .map((a) => `- ${a.name}${a.jobTitle ? `, ${a.jobTitle}` : ""}: ${a.bio.slice(0, 160)} ${a.voice.slice(0, 160)}`)
      .join("\n");
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
      const { json } = await chatJson<Partial<Fields>>(personaPrompt, `STORE\n${context || "(no details given)"}\n\nOWNER'S CHOICES\nGender: ${gender}\nAge range: ${age}\nWriting style: ${style || "any"}\nExtra notes: ${brief || "(none)"}\n\nEXISTING AUTHORS (the new persona must differ from all of these)\n${existing || "(none yet)"}\nRandom seed for variety: ${Math.random().toString(36).slice(2, 8)}`, {
        temperature: 0.95,
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
  const [gender, setGender] = useState("any");
  const [age, setAge] = useState("any");
  const [style, setStyle] = useState("any");
  const [version, setVersion] = useState(0); // remounts fields after the persona builder fills them
  const [makeDefault, setMakeDefault] = useState(isDefault);
  const saveF = useFetcher<Result>();
  const buildF = useFetcher<Result>();
  const set = (patch: Partial<Fields>) => setF((p) => ({ ...p, ...patch }));
  const picker = useFilePicker((p) => set({ photoUrl: p.url, photoAlt: p.alt }));
  const persona = f.kind === "persona";
  const built = buildF.data;

  const applied = useRef<unknown>(null);
  useEffect(() => {
    if (!built?.persona || applied.current === built) return;
    applied.current = built;
    setF((p) => ({ ...p, ...built.persona }));
    setVersion((v) => v + 1);
  }, [built]);

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
        <s-section heading="Generate an author">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Answer a few quick questions and we'll create a persona for you, different from your other authors. The details
              fill in below and you can change anything before saving.
            </s-paragraph>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
              <s-select label="Gender" value={gender} onChange={(e) => setGender(val(e as unknown as Event))}>
                <s-option value="any">Surprise me</s-option>
                <s-option value="woman">Woman</s-option>
                <s-option value="man">Man</s-option>
                <s-option value="non-binary">Non-binary</s-option>
              </s-select>
              <s-select label="Age range" value={age} onChange={(e) => setAge(val(e as unknown as Event))}>
                <s-option value="any">Surprise me</s-option>
                <s-option value="20s">20s</s-option>
                <s-option value="30s">30s</s-option>
                <s-option value="40s">40s</s-option>
                <s-option value="50s">50s</s-option>
                <s-option value="60s+">60s and over</s-option>
              </s-select>
              <s-select label="Writing style" value={style} onChange={(e) => setStyle(val(e as unknown as Event))}>
                <s-option value="any">Surprise me</s-option>
                <s-option value="friendly and conversational">Friendly and conversational</s-option>
                <s-option value="warm and story-led">Warm and story-led</s-option>
                <s-option value="calm and practical">Calm and practical</s-option>
                <s-option value="expert and straight-talking">Expert and straight-talking</s-option>
                <s-option value="light and witty">Light and witty</s-option>
                <s-option value="plain and no-nonsense">Plain and no-nonsense</s-option>
              </s-select>
            </s-grid>
            <s-text-field
              label="Anything else? (optional)"
              details="For example: loves explaining the science simply."
              value={brief}
              onInput={(e) => setBrief(val(e as unknown as Event))}
            />
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-button
                variant="primary"
                {...(buildF.state !== "idle" ? { loading: true } : {})}
                onClick={() => buildF.submit({ intent: "persona", gender, age, style, brief }, { method: "POST" })}
              >
                {f.name ? "Generate another author" : "Generate author"}
              </s-button>
              <s-text color="subdued">Nothing is saved until you save the author.</s-text>
            </s-stack>
            {built?.error ? <s-banner tone="warning">{built.error}</s-banner> : null}
            {built?.persona ? (
              <s-banner tone="success">
                Meet {built.persona.name}. Their details are filled in below. Not quite right? Generate another.
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
