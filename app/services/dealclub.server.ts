import prisma from "../db.server";

const DEALCLUB_BASE_URL = 'https://api.dealclub.de';

export async function fetchDealclubOrders(apiKey: string, updatedAt: number = 0) {
  if (!apiKey) throw new Error("Dealclub API Key is required");

  const statusRes = await fetch(`${DEALCLUB_BASE_URL}/api/order/statuses`, {
    headers: { 
      'apiKey': apiKey.trim(), 
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  if (!statusRes.ok) {
     const errText = await statusRes.text();
     throw new Error(`Could not fetch Dealclub statuses: ${statusRes.status} ${errText}`);
  }
  const statuses = await statusRes.json();

  let allOrders: any[] = [];

  for (const status of statuses) {
    if (status.id < 0) continue;

    const response = await fetch(`${DEALCLUB_BASE_URL}/api/orders?page=0&size=50&externalStatus=${status.id}&updatedAt=${updatedAt}`, {
      headers: {
        'apiKey': apiKey.trim(),
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });

    if (response.ok) {
      const data = await response.json();
      const orders = Array.isArray(data) ? data : (data.content || []);
      
      const mappedOrders = orders.map((o: any) => ({
        ...o,
        orderStatus: {
          ...o.orderStatus,
          statusName: status.description || o.orderStatus?.statusName || `Status ${status.id}`
        }
      }));
      
      allOrders.push(...mappedOrders);
    }
  }

  allOrders.sort((a, b) => parseInt(b.creationDate || "0", 10) - parseInt(a.creationDate || "0", 10));

  return allOrders;
}

export function mapDealclubToShopifyOrder(dealclubOrder: any) {
  const customer = dealclubOrder.customer || {};
  const billing = customer.billing || {};
  const delivery = customer.delivery || billing;

  const mapAddress = (addr: any) => ({
    first_name: addr.firstname || "",
    last_name: addr.lastname || "",
    address1: addr.address || "",
    address2: addr.addressLine2 || addr.addressSupplement || "",
    city: addr.city || "",
    province: addr.state || "",
    country: addr.country || "",
    zip: addr.zipcode || "",
    phone: addr.phone || "",
    company: addr.company || ""
  });

  const getPrice = (val: any) => parseFloat(String(val || "0").replace(",", "."));

  const lineItems = (dealclubOrder.articles || []).map((article: any) => {
    const variant = article.variant || {};
    let title = article.articleName || article.productCode || `Dealclub Artikel ${article.articleId}`;
    let qty = parseInt(variant.quantity || "1", 10);
    
    let price = getPrice(variant.price || article.taxValue || (getPrice(dealclubOrder.subtotal) / Math.max(1, qty)));

    let item: any = {
      title,
      quantity: Math.max(1, qty),
      price: price.toFixed(2),
      sku: String(article.productCode || article.articleId || ""),
      requires_shipping: true,
      taxable: true
    };

    if (article.tax) {
      let tax = getPrice(article.tax);
      item.tax_lines = [{
        title: "MwSt",
        price: getPrice(article.taxValue).toFixed(2),
        rate: tax > 1 ? tax / 100 : tax
      }];
    }
    return item;
  });

  const status = dealclubOrder.orderStatus || {};
  const orderId = dealclubOrder['Order ID'] || dealclubOrder.orderId || dealclubOrder.id || "";

  const noteAttributes = [
    { name: "dealclub_order_id", value: String(orderId) },
    { name: "dealclub_status", value: String(status.statusName || "") }
  ];

  const payload: any = {
    email: customer.email || "",
    line_items: lineItems,
    billing_address: mapAddress(billing),
    shipping_address: mapAddress(delivery),
    note: dealclubOrder.notes || `Dealclub order ${orderId}`,
    note_attributes: noteAttributes,
    tags: orderId ? `dealclub, dealclub-${orderId}` : 'dealclub',
    financial_status: "paid",
    currency: "EUR",
    source_name: "dealclub"
  };

  const shipping = getPrice(dealclubOrder.shippingCost);
  if (shipping > 0) {
    payload.shipping_lines = [{ title: "Dealclub Versand", price: shipping.toFixed(2) }];
  }

  const total = getPrice(dealclubOrder.total);
  if (total > 0) {
    payload.transactions = [{ kind: "sale", status: "success", amount: total.toFixed(2) }];
  }

  const created = dealclubOrder.creationDate;
  if (created) {
    payload.processed_at = new Date(parseInt(created, 10)).toISOString();
  }

  return payload;
}
