import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [MONTHLY_PLAN],
    isTest: true,
  });

  return { hasActivePayment };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  
  await billing.request({
    plan: MONTHLY_PLAN,
    isTest: true,
  });

  return null;
};

export default function Pricing() {
  const { hasActivePayment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state === "submitting";

  return (
    <s-page>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
        <img src="/logo.png" alt="Dealclub Logo" style={{ height: '40px', marginRight: '1rem' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>Abonnement (Pricing)</h1>
      </div>
      
      <s-section heading="Ihre Abonnement-Details">
        <s-paragraph>
          {hasActivePayment 
            ? "Sie haben ein aktives Abonnement. Sie können die DealClub-App uneingeschränkt nutzen." 
            : "Sie haben derzeit kein aktives Abonnement. Um Bestellungen synchronisieren zu können, ist das Standard-Abo erforderlich."}
        </s-paragraph>

        <div style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid #c9cccf', borderRadius: '8px', maxWidth: '400px', backgroundColor: hasActivePayment ? '#f0fdf4' : '#fff' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Standard-Abo</h2>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#008060', marginBottom: '1rem' }}>$5.49 <span style={{ fontSize: '1rem', color: '#666', fontWeight: 'normal' }}>/ Monat</span></p>
          <ul style={{ paddingLeft: '1.2rem', marginBottom: '1.5rem', lineHeight: '1.8' }}>
            <li>Automatische Bestell-Synchronisation</li>
            <li>Nahtlose API Integration</li>
            <li>Echtzeit-Aktualisierung</li>
            <li>Zuverlässiger Datenimport</li>
          </ul>

          {!hasActivePayment ? (
            <fetcher.Form method="post">
              <s-button type="submit" variant="primary" fullWidth {...(isSubmitting ? { loading: true } : {})}>
                {isSubmitting ? "Wird verarbeitet..." : "Jetzt Abonnieren"}
              </s-button>
            </fetcher.Form>
          ) : (
            <div style={{ padding: '0.75rem', backgroundColor: '#cce8d6', color: '#006e2a', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold' }}>
              ✓ Aktiviert
            </div>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
