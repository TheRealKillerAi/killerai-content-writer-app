import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (!url.searchParams.get("preview") && (url.searchParams.get("shop") || url.searchParams.get("host") || url.searchParams.get("embedded"))) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors;

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Blog articles that sound like you and stick to the facts</h1>
        <p className={styles.text}>
          KillerAi Content Writer researches what shoppers search for, then writes articles for your Shopify blog in your
          brand's voice. Every claim is checked against your own product information.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Your Shopify store address</span>
              <input className={styles.input} type="text" name="shop" placeholder="my-store.myshopify.com" />
              <span>{errors?.shop ?? "Enter your store address to open the app."}</span>
            </label>
            <button className={styles.button} type="submit">
              Open the app
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Facts first</strong>. Claims come only from your product page and the details you share. Nothing is invented.
          </li>
          <li>
            <strong>Authors and personas</strong>. Publish as a real person from your team, or create an author persona with its own voice.
          </li>
          <li>
            <strong>On a schedule</strong>. Topics are lined up a week ahead and each article is written the day before it goes out.
          </li>
        </ul>
        <p className={styles.text}>
          Questions? <a href="mailto:support@killerai.co">support@killerai.co</a>
        </p>
      </div>
    </div>
  );
}
