import sendDaily from "./daily-send-background.mjs";
import { kitSelected, kitReady } from "../lib/kit.mjs";
export default async () => {
  if (
    !process.env.NEWSLETTER_JOB_SECRET ||
    (kitSelected()
      ? !kitReady()
      : process.env.NEWSLETTER_SEND_ENABLED !== "true")
  )
    return;
  const r = await sendDaily(new Request(
    `${process.env.URL}/.netlify/functions/daily-send-background`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NEWSLETTER_JOB_SECRET}` },
    },
  ));
  if (!r.ok) throw new Error(`Dispatch failed: ${r.status}`);
};
export const config = { schedule: "0 13 * * *" };
