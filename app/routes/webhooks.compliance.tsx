import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GET: health check / human test (Shopify uses POST for real checks)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(
    JSON.stringify({
      endpoint: "compliance",
      topics: ["customers/data_request", "customers/redact", "shop/redact"],
      status: "ready",
      method: "POST only",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

// POST: handle all compliance topics with HMAC verification
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    switch (topic) {
      case "customers/data_request": {
        console.log("GDPR Data Request", { shop, payload });
        // App doesn’t store personal customer data; acknowledge request
        return new Response(
          JSON.stringify({ status: "ok", topic }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      case "customers/redact": {
        console.log("GDPR Customer Redact", { shop, payload });
        return new Response(
          JSON.stringify({ status: "ok", topic }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      case "shop/redact": {
        console.log("GDPR Shop Redact", { shop, payload });
        // If you store shop-scoped data, delete/anonymize here
        return new Response(
          JSON.stringify({ status: "ok", topic }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      default: {
        console.warn("Unexpected compliance topic", { topic });
        return new Response(
          JSON.stringify({ status: "ignored", topic }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }
  } catch (error: any) {
    // The Shopify library throws a Response (401) when HMAC verification fails.
    if (error instanceof Response) {
      return error; // propagate 401 Unauthorized to satisfy the automated check
    }
    console.error("Compliance webhook error", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
