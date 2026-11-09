import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { deleteAuthor, listAuthors } from "../lib/authors.server";
import { loadSettings, saveSettings } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [authors, settings] = await Promise.all([listAuthors(session.shop), loadSettings(session.shop)]);
  return { authors, defaultId: settings.defaultAuthorId };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");
  if (intent === "delete") {
    await deleteAuthor(session.shop, id);
    const s = await loadSettings(session.shop);
    if (s.defaultAuthorId === id) await saveSettings(session.shop, { ...s, defaultAuthorId: "" });
  }
  if (intent === "default") {
    const s = await loadSettings(session.shop);
    await saveSettings(session.shop, { ...s, defaultAuthorId: id });
  }
  return { ok: true };
};

export default function Authors() {
  const { authors, defaultId } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  return (
    <s-page heading="Authors">
      <s-button slot="primary-action" variant="primary" href="/app/authors/new">
        Add author
      </s-button>
      <s-section padding="none">
        {authors.length === 0 ? (
          <s-box padding="large">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Authors put a name on your articles. Add a real person from your team, or create a persona: an invented
                author with their own voice.
              </s-paragraph>
              <s-stack direction="inline">
                <s-button href="/app/authors/new">Add your first author</s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Author</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Default</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {authors.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      {a.photoUrl ? <s-thumbnail src={a.photoUrl} alt={a.photoAlt || a.name} size="small" /> : null}
                      <s-stack direction="block" gap="none">
                        <s-link href={`/app/authors/${a.id}`}>{a.name}</s-link>
                        {a.jobTitle ? <s-text color="subdued">{a.jobTitle}</s-text> : null}
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={a.kind === "persona" ? "info" : "neutral"}>
                      {a.kind === "persona" ? "AI persona" : "Real person"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {defaultId === a.id ? (
                      <s-badge tone="success">Default</s-badge>
                    ) : (
                      <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "default", id: a.id }, { method: "POST" })}>
                        Make default
                      </s-button>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-button variant="tertiary" href={`/app/authors/${a.id}`}>Edit</s-button>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => {
                          if (window.confirm(`Delete ${a.name}? Articles already on your blog keep their author name.`))
                            fetcher.submit({ intent: "delete", id: a.id }, { method: "POST" });
                        }}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
