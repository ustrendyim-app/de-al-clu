import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useState } from "react";
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

  const [lang, setLang] = useState<'de'|'en'>('en');

  return (
    <s-page>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button onClick={() => setLang('en')} style={{ padding: '0.4rem', marginRight: '0.5rem', cursor: 'pointer', fontWeight: lang === 'en' ? 'bold' : 'normal', background: lang === 'en' ? '#e1e3e5' : '#fff', border: '1px solid #c9cccf', borderRadius: '4px' }}>🇬🇧 English</button>
        <button onClick={() => setLang('de')} style={{ padding: '0.4rem', cursor: 'pointer', fontWeight: lang === 'de' ? 'bold' : 'normal', background: lang === 'de' ? '#e1e3e5' : '#fff', border: '1px solid #c9cccf', borderRadius: '4px' }}>🇩🇪 Deutsch</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
        <img src="/logo.png" alt="Dealclub Logo" style={{ height: '40px', marginRight: '1rem' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>
          {lang === 'de' ? 'Abonnement (Pricing)' : 'Subscription (Pricing)'}
        </h1>
      </div>
      
      <s-section heading={lang === 'de' ? "Ihre Abonnement-Details" : "Your Subscription Details"}>
        <s-paragraph>
          {hasActivePayment 
            ? (lang === 'de' ? "Sie haben ein aktives Abonnement. Sie können die DealClub-App uneingeschränkt nutzen." : "You have an active subscription. You can use the DealClub App without restrictions.")
            : (lang === 'de' ? "Sie haben derzeit kein aktives Abonnement. Um Bestellungen synchronisieren zu können, ist das Standard-Abo erforderlich." : "You currently have no active subscription. The Standard Plan is required to sync orders.")}
        </s-paragraph>

        <div style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid #c9cccf', borderRadius: '8px', maxWidth: '400px', backgroundColor: hasActivePayment ? '#f0fdf4' : '#fff' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            {lang === 'de' ? 'Standard-Abo' : 'Standard Plan'}
          </h2>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#008060', marginBottom: '1rem' }}>$5.49 <span style={{ fontSize: '1rem', color: '#666', fontWeight: 'normal' }}>/ {lang === 'de' ? 'Monat' : 'Month'}</span></p>
          <ul style={{ paddingLeft: '1.2rem', marginBottom: '1.5rem', lineHeight: '1.8' }}>
            <li>{lang === 'de' ? 'Automatische Bestell-Synchronisation' : 'Automatic Order Synchronization'}</li>
            <li>{lang === 'de' ? 'Nahtlose API Integration' : 'Seamless API Integration'}</li>
            <li>{lang === 'de' ? 'Echtzeit-Aktualisierung' : 'Real-time Updates'}</li>
            <li>{lang === 'de' ? 'Zuverlässiger Datenimport' : 'Reliable Data Import'}</li>
          </ul>

          {!hasActivePayment ? (
            <fetcher.Form method="post">
              <s-button type="submit" variant="primary" fullWidth {...(isSubmitting ? { loading: true } : {})}>
                {isSubmitting 
                  ? (lang === 'de' ? "Wird verarbeitet..." : "Processing...") 
                  : (lang === 'de' ? "Jetzt Abonnieren" : "Subscribe Now")}
              </s-button>
            </fetcher.Form>
          ) : (
            <div style={{ padding: '0.75rem', backgroundColor: '#cce8d6', color: '#006e2a', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold' }}>
              ✓ {lang === 'de' ? 'Aktiviert' : 'Activated'}
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
