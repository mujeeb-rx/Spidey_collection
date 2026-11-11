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
        payment_method: addr && addr.payment_method ? String(addr.payment_method) : 'COD',
        updated_at: new Date().toISOString()
      }, { merge: true });
      return { error: null };
    } catch (error) {
      return { error: error };
    }
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
  });
};
