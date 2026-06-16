import { authenticate } from "../shopify.server";

export const action = async ({ request }: { request: Request }) => {
  try {
    const { topic, shop, session, admin } = await authenticate.webhook(request);
    console.log(`GDPR Webhook received: ${topic} for shop ${shop}`);
    
    // Shopify GDPR compliance webhooks require a 200 OK response.
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook authentication failed:", err);
    return new Response("Unauthorized", { status: 401 });
  }
};
