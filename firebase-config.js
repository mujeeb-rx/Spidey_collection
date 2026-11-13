// SPIDEY COLLECTIONS — Firebase Backend Configuration & Helpers
const firebaseConfig = {
  apiKey: "AIzaSyCn_iMnQC_FBWZPjANjyxJHxJc0vdiBSLE",
  authDomain: "spideycollections-e7bdd.firebaseapp.com",
  projectId: "spideycollections-e7bdd",
  storageBucket: "spideycollections-e7bdd.firebasestorage.app",
  messagingSenderId: "406791682112",
  appId: "1:406791682112:web:c4bbca0a39961c0bc5c7a5",
  measurementId: "G-5YMJTPBPFP"
};

let fbApp = null;
let fbAuth = null;
let fbDb = null;
let fbAnalytics = null;

try {
  if (typeof window !== 'undefined' && window.firebase) {
    fbApp = (firebase.apps && firebase.apps.length)
      ? firebase.app()
      : firebase.initializeApp(firebaseConfig);
    fbAuth = typeof firebase.auth === 'function' ? firebase.auth() : null;
    fbDb = typeof firebase.firestore === 'function' ? firebase.firestore() : null;
    try {
      if (typeof firebase.analytics === 'function' && window.location.protocol !== 'file:') {
        fbAnalytics = firebase.analytics();
      }
    } catch (analyticsErr) {}
  }
} catch (err) {
  console.warn('Firebase initialization warning:', err);
}

function _normalizeFbUser(user, fallbackName) {
  if (!user) return null;
  const email = user.email || '';
  const name = user.displayName || fallbackName || (email ? email.split('@')[0].replace(/[._]/g, ' ') : 'Spidey Member');
  return {
    id: user.uid,
    email: email,
    user_metadata: { full_name: name }
  };
}

window.SpideyFirebase = {
  // --- Auth ---
  signInWithPassword: async function(email, password) {
    if (!fbAuth) return { data: { user: null }, error: new Error('Firebase Auth not initialized') };
    try {
      const cred = await fbAuth.signInWithEmailAndPassword(email, password);
      return { data: { user: _normalizeFbUser(cred.user) }, error: null };
    } catch (error) {
      return { data: { user: null }, error: error };
    }
  },

  signUp: async function({ email, password, options }) {
    if (!fbAuth) return { data: { user: null, session: null }, error: new Error('Firebase Auth not initialized') };
    const fullName = options && options.data && options.data.full_name ? options.data.full_name : '';
    try {
      const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
      if (fullName && cred.user && typeof cred.user.updateProfile === 'function') {
        try { await cred.user.updateProfile({ displayName: fullName }); } catch (e) {}
      }
      const normalized = _normalizeFbUser(cred.user, fullName);
      return { data: { user: normalized, session: { user: normalized } }, error: null };
    } catch (error) {
      return { data: { user: null, session: null }, error: error };
    }
  },

  signInWithGoogle: async function(callbacks) {
    const onSuccess = callbacks && callbacks.onSuccess;
    const onFinally = callbacks && callbacks.onFinally;
    if (!fbAuth) {
      if (onFinally) onFinally();
      return { data: { user: null }, error: new Error('Firebase Auth not initialized') };
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await fbAuth.signInWithPopup(provider);
      const user = _normalizeFbUser(cred.user);
      if (onSuccess) onSuccess(user);
      if (onFinally) onFinally();
      return { data: { user: user }, error: null };
    } catch (error) {
      if (onFinally) onFinally();
      if (error && (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request')) {
        return { data: { user: null }, error: null };
      }
      throw error;
    }
  },

  signOut: async function() {
    if (!fbAuth) return;
    await fbAuth.signOut();
  },

  getSession: async function() {
    if (!fbAuth) return { data: { session: null } };
    const user = fbAuth.currentUser;
    return {
      data: {
        session: user ? { user: _normalizeFbUser(user) } : null
      }
    };
  },

  onAuthStateChange: function(callback) {
    if (!fbAuth || typeof callback !== 'function') return function() {};
    return fbAuth.onAuthStateChanged(function(user) {
      callback(user ? 'SIGNED_IN' : 'SIGNED_OUT', user ? { user: _normalizeFbUser(user) } : null);
    });
  },

  // --- Products ---
  _mapProductDoc: function(doc) {
    const data = doc.data() || {};
    return {
      ...data,
      _docId: doc.id,
      id: data.id !== undefined ? data.id : doc.id
    };
  },

  fetchProducts: async function() {
    if (!fbDb) return { data: null, error: new Error('Firestore not initialized') };
    try {
      const snap = await fbDb.collection('products').get();
      const rows = snap.docs
        .map(window.SpideyFirebase._mapProductDoc)
        .sort(function(a, b) { return (Number(a.id) || 0) - (Number(b.id) || 0); });
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: error };
    }
  },

  subscribeProducts: function(onChange) {
    if (!fbDb || typeof onChange !== 'function') return function() {};
    return fbDb.collection('products').onSnapshot(
      function(snap) {
        const rows = snap.docs
          .map(window.SpideyFirebase._mapProductDoc)
          .sort(function(a, b) { return (Number(a.id) || 0) - (Number(b.id) || 0); });
        onChange(rows);
      },
      function(err) {
        console.warn('Firebase products snapshot notice:', err);
      }
    );
  },

  upsertProduct: async function(productId, payload) {
    if (!fbDb) return { data: null, error: new Error('Firestore not initialized') };
    try {
      const idVal = (productId !== undefined && productId !== null && productId !== '')
        ? (isNaN(Number(productId)) ? String(productId) : Number(productId))
        : Date.now();
      const docId = String(idVal);
      const docData = { ...payload, id: idVal };
      await fbDb.collection('products').doc(docId).set(docData);
      return { data: [docData], error: null };
    } catch (error) {
      return { data: null, error: error };
    }
  },

  updateProductSizes: async function(productId, sizes) {
    if (!fbDb) return { error: new Error('Firestore not initialized') };
    try {
      await fbDb.collection('products').doc(String(productId)).update({ sizes: sizes });
      return { error: null };
    } catch (error) {
      return { error: error };
    }
  },

  deleteProduct: async function(productId) {
    if (!fbDb) return { error: new Error('Firestore not initialized') };
    try {
      const docKey = String(productId);
      await fbDb.collection('products').doc(docKey).delete();
      const numId = Number(productId);
      if (!isNaN(numId)) {
        const byNum = await fbDb.collection('products').where('id', '==', numId).get();
        await Promise.all(byNum.docs.map(function(d) { return d.ref.delete(); }));
      }
      const byStr = await fbDb.collection('products').where('id', '==', docKey).get();
      await Promise.all(byStr.docs.map(function(d) { return d.ref.delete(); }));
      return { error: null };
    } catch (error) {
      return { error: error };
    }
  },

  // --- Orders ---
  saveOrder: async function(orderId, orderPayload) {
    if (!fbDb) return;
    await fbDb.collection('orders').doc(String(orderId)).set({
      id: orderId,
      created_at: new Date().toISOString(),
      ...orderPayload
    });
  },

  subscribeOrders: function(onChange) {
    if (!fbDb || typeof onChange !== 'function') return function() {};
    return fbDb.collection('orders').orderBy('created_at', 'desc').onSnapshot(
      function(snap) {
        const rows = snap.docs.map(function(doc) { return doc.data(); });
        onChange(rows);
      },
      function(err) {
        console.warn('Firebase orders snapshot notice:', err);
      }
    );
  },

  updateOrderStatus: async function(orderId, newStatus) {
    if (!fbDb) return;
    await fbDb.collection('orders').doc(String(orderId)).set({ status: newStatus }, { merge: true });
  },

  deleteOrder: async function(orderId) {
    if (!fbDb) return;
    await fbDb.collection('orders').doc(String(orderId)).delete();
  },

  fetchOrderById: async function(orderId) {
    if (!fbDb || !orderId) return null;
    const rawId = String(orderId).trim();
    if (!rawId) return null;
    try {
      let doc = await fbDb.collection('orders').doc(rawId).get();
      if (!doc.exists && rawId !== rawId.toUpperCase()) {
        doc = await fbDb.collection('orders').doc(rawId.toUpperCase()).get();
      }
      if (doc.exists) return { id: doc.id, ...doc.data() };

      const q1 = await fbDb.collection('orders').where('id', '==', rawId).limit(1).get();
      if (!q1.empty) return { id: q1.docs[0].id, ...q1.docs[0].data() };

      const q2 = await fbDb.collection('orders').where('id', '==', rawId.toUpperCase()).limit(1).get();
      if (!q2.empty) return { id: q2.docs[0].id, ...q2.docs[0].data() };
    } catch (e) {
      console.warn('Firebase fetchOrderById notice:', e);
    }
    return null;
  },

  subscribeOrderById: function(orderId, onChange) {
    if (!fbDb || !orderId || typeof onChange !== 'function') return function() {};
    const docId = String(orderId).trim();
    return fbDb.collection('orders').doc(docId).onSnapshot(
      function(doc) {
        if (doc.exists) {
          onChange({ id: doc.id, ...doc.data() });
        }
      },
      function(err) {
        console.warn('Firebase single order snapshot notice:', err);
      }
    );
  },

  // --- Shared Email & Tracking Helpers (used by index.html & admin.html) ---
  getProductCategoryLabel: function(item, product) {
    const rawCat = String(
      (item && (item.category || item.type)) ||
      (product && (product.c || product.t)) ||
      ''
    ).toLowerCase();
    const rawName = String((item && item.name) || (product && product.n) || '').toLowerCase();
    const combined = `${rawCat} ${rawName}`;

    if (combined.includes('hoodie')) return 'Hoodie';
    if (combined.includes('sweat')) return 'Sweatshirt';
    if (combined.includes('oversized')) return 'Oversized T-Shirt';
    if (combined.includes('tee') || combined.includes('t-shirt') || combined.includes('tshirt')) return 'Graphic T-Shirt';
    if (combined.includes('shirt') || combined.includes('polo')) return 'Streetwear Shirt';
    if (combined.includes('pant') || combined.includes('jean') || combined.includes('cargo') || combined.includes('denim') || combined.includes('short')) return 'Bottoms / Denim';
    if (combined.includes('jacket') || combined.includes('zip') || combined.includes('outer')) return 'Outerwear';
    if (combined.includes('cap') || combined.includes('bag') || combined.includes('acc')) return 'Accessory';

    const fallback = (item && item.category) || (product && product.c) || '';
    return fallback ? String(fallback).trim() : 'Streetwear Apparel';
  },

  resolveEmailProductImage: function(item, productsList) {
    const list = Array.isArray(productsList) ? productsList : [];
    const prod = item ? list.find(function(p) { return String(p.id) === String(item.id); }) : null;
    const candidates = [];
    if (item && item.image) candidates.push(item.image);
    if (item && item.img) candidates.push(item.img);
    if (prod) {
      if (Array.isArray(prod.images)) {
        prod.images.forEach(function(u) { if (u) candidates.push(u); });
      }
      if (prod.imgFront) candidates.push(prod.imgFront);
      if (prod.img) candidates.push(prod.img);
    }

    for (let i = 0; i < candidates.length; i++) {
      const url = String(candidates[i] || '').trim();
      if (/^https?:\/\//i.test(url) && !/\.svg(\?|$)/i.test(url)) {
        // Convert Cloudinary webp/auto URLs to universal JPEG thumbnails for Gmail & Outlook
        if (url.includes('res.cloudinary.com') && url.includes('/upload/') && !url.includes('/upload/w_')) {
          return url.replace('/upload/', '/upload/w_160,h_200,c_fill,f_jpg,q_80/');
        }
        return url;
      }
    }
    return '';
  },

  getOrderTrackingUrl: function(orderOrId) {
    const order = (orderOrId && typeof orderOrId === 'object') ? orderOrId : { id: orderOrId };
    const orderId = String((order && order.id) || '').trim();
    const qs = orderId ? `?track=${encodeURIComponent(orderId)}` : '';

    let baseUrl = '';
    if (order && order.store_url && /^https?:\/\//i.test(String(order.store_url))) {
      baseUrl = String(order.store_url).split(/[?#]/)[0];
    } else if (typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.protocol)) {
      let current = window.location.href.split(/[?#]/)[0];
      if (/\/admin\.html$/i.test(current)) {
        current = current.replace(/\/admin\.html$/i, '/index.html');
      } else if (/\/admin\/?$/i.test(current)) {
        current = current.replace(/\/admin\/?$/i, '/index.html');
      }
      baseUrl = current;
    } else {
      try {
        const cached = localStorage.getItem('spidey_live_store_url') || '';
        if (/^https?:\/\//i.test(cached)) baseUrl = cached.split(/[?#]/)[0];
      } catch (e) {}
    }

    if (baseUrl) {
      return `${baseUrl}${qs}`;
    }
    if (typeof window !== 'undefined') {
      let localUrl = window.location.href.split(/[?#]/)[0];
      if (/\/admin\.html$/i.test(localUrl)) {
        localUrl = localUrl.replace(/\/admin\.html$/i, '/index.html');
      }
      return `${localUrl}${qs}`;
    }
    return `index.html${qs}`;
  },

  buildOrderItemsHtml: function(order, productsList) {
    const self = this;
    const esc = function(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    const list = Array.isArray(productsList) ? productsList : [];
    const items = (order && Array.isArray(order.items)) ? order.items : [];

    return items.map(function(item) {
      const prod = list.find(function(p) { return String(p.id) === String(item.id); });
      const catLabel = self.getProductCategoryLabel(item, prod);
      const imgUrl = self.resolveEmailProductImage(item, list);
      const itemQty = Number(item.q || 1);
      const lineTotal = ((Number(item.price) || 0) * itemQty).toLocaleString('en-IN');
      const shortBadge = esc(catLabel.split(' ')[0].toUpperCase().slice(0, 8));

      const mediaHtml = imgUrl
        ? `<img src="${esc(imgUrl)}" alt="${esc(catLabel)} - ${esc(item.name)}" width="62" height="76" style="display:block;width:62px;height:76px;object-fit:cover;border-radius:4px;border:1px solid #333333;background:#1a1a1a;">`
        : `<div style="width:62px;height:76px;border-radius:4px;border:1px solid #E50914;background:#1b1b1f;color:#ffffff;text-align:center;box-sizing:border-box;padding:18px 4px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.8px;color:#E50914;">${shortBadge}</div><div style="font-size:10px;color:#bbbbbb;margin-top:4px;">${esc(item.color || 'Edition')}</div></div>`;

      return `
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-bottom:1px solid #2a2a2a;padding:10px 0;">
          <tr>
            <td width="74" style="width:74px;vertical-align:top;padding-right:12px;">
              ${mediaHtml}
            </td>
            <td style="vertical-align:middle;text-align:left;">
              <div style="display:inline-block;background:#E50914;color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;padding:2px 6px;border-radius:2px;margin-bottom:4px;">${esc(catLabel)}</div>
              <div style="font-weight:700;color:#ffffff;font-size:14px;letter-spacing:0.3px;line-height:1.3;">${esc(item.name || 'Streetwear Item')}</div>
              <div style="font-size:12px;color:#999999;margin-top:4px;">Size: <b style="color:#E50914;">${esc(item.size || 'Regular')}</b> &bull; Qty: ${itemQty}${item.color ? ` &bull; Color: ${esc(item.color)}` : ''}</div>
            </td>
            <td align="right" style="vertical-align:middle;text-align:right;font-weight:800;color:#ffffff;font-size:14px;white-space:nowrap;padding-left:12px;">
              &#8377;${lineTotal}
            </td>
          </tr>
        </table>
      `;
    }).join('');
  },

  dispatchOrderEmail: async function(opts) {
    const order = (opts && opts.order) || {};
    const statusKey = String((opts && opts.status) || order.status || 'pending').toLowerCase();
    const isInitialOrder = Boolean(opts && opts.isInitialOrder);
    const productsList = (opts && opts.productsList) || [];
    const adminStoreEmail = 'Shaikimran3912@gmail.com';
    const recipientEmail = String((opts && opts.recipientEmail) || order.customer_email || adminStoreEmail).trim();
    const customerName = String(order.customer_name || 'Valued Customer').trim();
    const orderId = String(order.id || 'SPIDEY-ORDER');

    const statusMetaMap = {
      pending: {
        subject: `Order Confirmation - #${orderId} | SPIDEY COLLECTIONS`,
        headline: 'Order Received & Confirmed',
        label: 'Order Placed (Pending Confirmation)',
        description: 'Thank you for shopping with SPIDEY COLLECTIONS. We have received your order and our dispatch team is preparing your items.'
      },
      confirmed: {
        subject: `Order Confirmed - #${orderId} | SPIDEY COLLECTIONS`,
        headline: 'Order Confirmed & Packing',
        label: 'Confirmed & Packing',
        description: 'Your order has been verified and confirmed by our team. Your streetwear is being packed carefully for dispatch.'
      },
      shipped: {
        subject: `Order #${orderId} Has Shipped | SPIDEY COLLECTIONS`,
        headline: 'Order Shipped & On The Way',
        label: 'Shipped / In Transit',
        description: 'Good news! Your package has been dispatched from our warehouse and is on the way to your delivery address.'
      },
      delivered: {
        subject: `Order #${orderId} Delivered | SPIDEY COLLECTIONS`,
        headline: 'Order Delivered Successfully',
        label: 'Delivered',
        description: 'Your SPIDEY COLLECTIONS order has been delivered to your address. Thank you for wearing SPIDEY COLLECTIONS.'
      },
      cancelled: {
        subject: `Order #${orderId} Update - Cancelled | SPIDEY COLLECTIONS`,
        headline: 'Order Cancelled',
        label: 'Cancelled',
        description: 'This order has been cancelled. If you have any questions regarding your order or refund, reply to this email or contact us on WhatsApp.'
      }
    };

    const meta = statusMetaMap[statusKey] || statusMetaMap.pending;
    if (isInitialOrder && statusKey === 'pending') {
      meta.subject = `Order Confirmation - #${orderId} | SPIDEY COLLECTIONS`;
    }

    const trackUrl = this.getOrderTrackingUrl(order);
    const itemsHtml = this.buildOrderItemsHtml(order, productsList);
    const firstItem = (order.items && order.items[0]) || null;
    const firstProd = firstItem ? productsList.find(function(p) { return String(p.id) === String(firstItem.id); }) : null;
    const primaryImage = firstItem ? this.resolveEmailProductImage(firstItem, productsList) : '';
    const primaryType = firstItem ? this.getProductCategoryLabel(firstItem, firstProd) : 'Streetwear Apparel';

    const itemsSummary = (order.items || []).map((item) => {
      const prod = productsList.find(function(p) { return String(p.id) === String(item.id); });
      const catLabel = this.getProductCategoryLabel(item, prod);
      const lineTotal = ((Number(item.price) || 0) * (Number(item.q) || 1)).toLocaleString('en-IN');
      return `- [${catLabel}] ${item.name} (Size: ${item.size || 'M'}, Qty: ${item.q || 1}) - Rs. ${lineTotal}`;
    }).join('\n');

    const deliveryAddress = [order.shipping_address, order.city, order.pincode].filter(Boolean).join(', ') || 'Address on file';
    const orderDate = order.created_at
      ? new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
      : new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const formattedTotal = `Rs. ${(Number(order.total_amount) || 0).toLocaleString('en-IN')}`;
    const rupeeTotal = `₹${(Number(order.total_amount) || 0).toLocaleString('en-IN')}`;
    const extraNote = (opts && opts.extraNote) ? `\n${opts.extraNote}` : '';

    const messageContent = `${meta.headline} (${meta.label})\n\nOrder ID: ${orderId}\nTrack Order & Delivery Address:\n${trackUrl}\n\nDate: ${orderDate}\nCustomer: ${customerName}\nPhone: ${order.customer_phone || 'N/A'}\nShipping Address: ${deliveryAddress}\nPayment: ${order.payment_method || 'Razorpay'}\nTotal Amount: ${formattedTotal}\n\nItems:\n${itemsSummary}\n\n${meta.description}${extraNote}\n\nSPIDEY COLLECTIONS — Streetwear Redefined`;

    const emailParams = Object.assign({
      subject: meta.subject,
      headline: meta.headline,
      status: meta.label,
      status_key: statusKey,
      status_description: meta.description,
      order_id: orderId,
      orderId: orderId,
      track_url: trackUrl,
      tracking_url: trackUrl,
      customer_name: customerName,
      to_name: customerName,
      name: customerName,
      customer_email: recipientEmail,
      to_email: recipientEmail,
      email: recipientEmail,
      user_email: recipientEmail,
      recipient: recipientEmail,
      recipient_email: recipientEmail,
      client_email: recipientEmail,
      reply_to: adminStoreEmail,
      customer_phone: order.customer_phone || 'N/A',
      phone: order.customer_phone || 'N/A',
      shipping_address: deliveryAddress,
      address: deliveryAddress,
      shipping_street: order.shipping_address || '',
      city: order.city || '',
      pincode: order.pincode || '',
      from_name: 'SPIDEY COLLECTIONS',
      store_name: 'SPIDEY COLLECTIONS',
      payment_method: order.payment_method || 'Razorpay',
      total_amount: rupeeTotal,
      total: rupeeTotal,
      order_date: orderDate,
      date: orderDate,
      items_html: itemsHtml,
      items_summary: itemsSummary,
      product_type: primaryType,
      product_image: primaryImage,
      message: messageContent,
      company_name: 'SPIDEY COLLECTIONS'
    }, (opts && opts.extraVars) || {});

    const serviceId = 'service_nlf4ava';
    const templateId = 'template_bo142e9';
    const publicKey = 'xGmwUMmAPWGZ1FKSv';

    try {
      if (typeof window !== 'undefined' && window.emailjs && typeof window.emailjs.send === 'function') {
        await window.emailjs.send(serviceId, templateId, emailParams, publicKey);
        return { ok: true, trackUrl: trackUrl, statusLabel: meta.label };
      }
      throw new Error('EmailJS SDK unavailable');
    } catch (sdkErr) {
      const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: emailParams
        })
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(function() { return 'EmailJS HTTP ' + resp.status; });
        return { ok: false, error: errText, trackUrl: trackUrl, statusLabel: meta.label };
      }
      return { ok: true, trackUrl: trackUrl, statusLabel: meta.label };
    }
  },

  // --- Newsletter Subscribers ---
  addSubscriber: async function(email) {
    if (!fbDb) return { error: new Error('Firestore not initialized') };
    try {
      const key = String(email).trim().toLowerCase();
      await fbDb.collection('newsletter_subscribers').doc(key).set({
        email: String(email).trim(),
        created_at: new Date().toISOString()
      });
      return { error: null };
    } catch (error) {
      return { error: error };
    }
  },

  subscribeSubscribers: function(onChange) {
    if (!fbDb || typeof onChange !== 'function') return function() {};
    return fbDb.collection('newsletter_subscribers').orderBy('created_at', 'desc').onSnapshot(
      function(snap) {
        const rows = snap.docs.map(function(doc) { return doc.data(); });
        onChange(rows);
      },
      function(err) {
        console.warn('Firebase subscribers snapshot notice:', err);
      }
    );
  },

  deleteSubscriber: async function(email) {
    if (!fbDb) return;
    await fbDb.collection('newsletter_subscribers').doc(String(email).trim().toLowerCase()).delete();
  },

  // --- Store Config (Categories, Banners, Social, Contact) ---
  fetchStoreConfig: async function() {
    if (!fbDb) return { data: null, error: new Error('Firestore not initialized') };
    try {
      const doc = await fbDb.collection('store_config').doc('main').get();
      return { data: doc.exists ? doc.data() : null, error: null };
    } catch (error) {
      return { data: null, error: error };
    }
  },

  saveStoreConfig: async function(cfg) {
    if (!fbDb) return { error: new Error('Firestore not initialized') };
    try {
      await fbDb.collection('store_config').doc('main').set({
        categories: Array.isArray(cfg.categories) ? cfg.categories : [],
        banners: cfg.banners || {},
        social: cfg.social || {},
        contact: cfg.contact || {},
        coupon: cfg.coupon || {},
        updated_at: new Date().toISOString()
      });
      return { error: null };
    } catch (error) {
      return { error: error };
    }
  },

  subscribeStoreConfig: function(onChange) {
    if (!fbDb || typeof onChange !== 'function') return function() {};
    return fbDb.collection('store_config').doc('main').onSnapshot(
      function(doc) {
        if (doc.exists) onChange(doc.data());
      },
      function(err) {
        console.warn('Firebase store_config snapshot notice:', err);
      }
    );
  },

  // --- Era Collections (Style Era Category Cards & Photos) ---
  fetchEraCollections: async function() {
    if (!fbDb) return { data: null, error: new Error('Firestore not initialized') };
    try {
      const snap = await fbDb.collection('era_collections').get();
      const rows = snap.docs
        .map(function(doc) {
          const d = doc.data() || {};
          return {
            order: Number(d.order) || 0,
            title: d.title || '',
            image: d.image || '',
            productId: d.productId !== undefined ? d.productId : null
          };
        })
        .sort(function(a, b) { return a.order - b.order; })
        .map(function(item) {
          return { title: item.title, image: item.image, productId: item.productId };
        });
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: error };
    }
  },

  saveEraCollections: async function(eras) {
    if (!fbDb) return { error: new Error('Firestore not initialized') };
    try {
      const list = Array.isArray(eras) ? eras : [];
      const existingSnap = await fbDb.collection('era_collections').get();
      const keepIds = new Set(list.map(function(_, idx) { return 'era_' + idx; }));
      const deletes = existingSnap.docs
        .filter(function(doc) { return !keepIds.has(doc.id); })
        .map(function(doc) { return doc.ref.delete(); });
      const writes = list.map(function(era, idx) {
        return fbDb.collection('era_collections').doc('era_' + idx).set({
          order: idx,
          title: era && era.title ? String(era.title) : '',
          image: era && era.image ? String(era.image) : '',
          productId: era && era.productId !== undefined && era.productId !== null ? era.productId : null
        });
      });
      await Promise.all(deletes.concat(writes));
      return { error: null };
    } catch (error) {
      return { error: error };
    }
  },

  subscribeEraCollections: function(onChange) {
    if (!fbDb || typeof onChange !== 'function') return function() {};
    return fbDb.collection('era_collections').onSnapshot(
      function(snap) {
        if (snap.empty) {
          onChange([]);
          return;
        }
        const rows = snap.docs
          .map(function(doc) {
            const d = doc.data() || {};
            return {
              order: Number(d.order) || 0,
              title: d.title || '',
              image: d.image || '',
              productId: d.productId !== undefined ? d.productId : null
            };
          })
          .sort(function(a, b) { return a.order - b.order; })
          .map(function(item) {
            return { title: item.title, image: item.image, productId: item.productId };
          });
        onChange(rows);
      },
      function(err) {
        console.warn('Firebase era_collections snapshot notice:', err);
      }
    );
  },

  // --- Customer Saved Address / Profile ---
  _profileDocKey: function(identifier) {
    return String(identifier || '').trim().toLowerCase().replace(/[^a-z0-9._@-]/g, '_');
  },

  fetchUserAddress: async function(identifier) {
    if (!fbDb) return { data: null, error: new Error('Firestore not initialized') };
    const docKey = window.SpideyFirebase._profileDocKey(identifier);
    if (!docKey) return { data: null, error: null };
    try {
      const doc = await fbDb.collection('customer_profiles').doc(docKey).get();
      return { data: doc.exists ? doc.data() : null, error: null };
    } catch (error) {
      return { data: null, error: error };
    }
  },

  saveUserAddress: async function(identifier, addr) {
    if (!fbDb) return { error: new Error('Firestore not initialized') };
    const docKey = window.SpideyFirebase._profileDocKey(identifier);
    if (!docKey) return { error: null };
    try {
      await fbDb.collection('customer_profiles').doc(docKey).set({
        name: addr && addr.name ? String(addr.name) : '',
        phone: addr && addr.phone ? String(addr.phone) : '',
        email: addr && addr.email ? String(addr.email) : '',
        address: addr && addr.address ? String(addr.address) : '',
        city: addr && addr.city ? String(addr.city) : '',
        pincode: addr && addr.pincode ? String(addr.pincode) : '',
        payment_method: addr && addr.payment_method ? String(addr.payment_method) : 'Razorpay',
        updated_at: new Date().toISOString()
      }, { merge: true });
      return { error: null };
    } catch (error) {
      return { error: error };
    }
  },

  saveUserBasicProfile: async function(user) {
    if (!fbDb || !user) return { error: null };
    const identifier = user.email || user.id;
    const docKey = window.SpideyFirebase._profileDocKey(identifier);
    if (!docKey) return { error: null };
    try {
      const payload = {
        uid: user.id || '',
        email: user.email ? String(user.email).trim() : '',
        name: (user.user_metadata && user.user_metadata.full_name) ? String(user.user_metadata.full_name).trim() : '',
        last_login_at: new Date().toISOString()
      };
      await fbDb.collection('customer_profiles').doc(docKey).set(payload, { merge: true });
      return { error: null };
    } catch (error) {
      return { error: error };
    }
  },

  fetchAllCustomerProfiles: async function() {
    if (!fbDb) return { data: [], error: new Error('Firestore not initialized') };
    try {
      const snap = await fbDb.collection('customer_profiles').get();
      const rows = snap.docs.map(function(doc) {
        return { _docId: doc.id, ...(doc.data() || {}) };
      });
      return { data: rows, error: null };
    } catch (error) {
      return { data: [], error: error };
    }
  },

  subscribeCustomerProfiles: function(onChange) {
    if (!fbDb || typeof onChange !== 'function') return function() {};
    return fbDb.collection('customer_profiles').onSnapshot(
      function(snap) {
        const rows = snap.docs.map(function(doc) {
          return { _docId: doc.id, ...(doc.data() || {}) };
        });
        onChange(rows);
      },
      function(err) {
        console.warn('Firebase customer_profiles snapshot notice:', err);
      }
    );
  }
};

// Admin Console Live Orders/Subscribers Sync (no sign-in required)
window.initAdminFirebaseSync = function() {
  if (!fbDb) return;
  window.SpideyFirebase.subscribeOrders(function(cloudOrders) {
    if (!Array.isArray(cloudOrders) || !cloudOrders.length || !window.SpideyStore) return;
    const localOrders = window.SpideyStore.getOrders() || [];
    const mergedMap = new Map();
    localOrders.forEach(function(o) { if (o && o.id) mergedMap.set(String(o.id), o); });
    cloudOrders.forEach(function(o) { if (o && o.id) mergedMap.set(String(o.id), o); });
    const merged = Array.from(mergedMap.values()).sort(function(a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    window.SpideyStore.saveOrders(merged);
    if (typeof renderOrdersTable === 'function') renderOrdersTable();
    if (typeof updateStats === 'function') updateStats();
  });

  window.SpideyFirebase.subscribeSubscribers(function(cloudSubs) {
    if (!Array.isArray(cloudSubs) || !cloudSubs.length || !window.SpideyStore) return;
    cloudSubs.forEach(function(s) {
      if (s && s.email) window.SpideyStore.addSubscriber(s.email);
    });
    if (typeof renderSubscribersTable === 'function') renderSubscribersTable();
    if (typeof updateStats === 'function') updateStats();
    if (typeof renderUsersTable === 'function') renderUsersTable();
  });

  if (window.SpideyFirebase.subscribeCustomerProfiles) {
    window.SpideyFirebase.subscribeCustomerProfiles(function(cloudProfiles) {
      window._adminCloudCustomerProfiles = Array.isArray(cloudProfiles) ? cloudProfiles : [];
      if (typeof renderUsersTable === 'function') renderUsersTable();
      if (typeof updateStats === 'function') updateStats();
    });
  }
};
