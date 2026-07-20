import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  FileText, 
  AlertCircle, 
  Folder, 
  Layers, 
  Clock, 
  Check, 
  Loader2,
  Compass,
  Pencil,
  LogOut,
  Lock,
  User,
  ShieldCheck,
  Key
} from 'lucide-react';

import { API_URL } from './config';

export default function Admin({ onBack }) {
  // Auth State
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [username, setUsername] = useState(() => localStorage.getItem('username') || '');

  // Auth Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [members, setMembers] = useState([]);
  
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  
  // Product Creation State
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

  // Product Edit/Delete State
  const [editingProduct, setEditingProduct] = useState(null);
  const [editProductName, setEditProductName] = useState('');
  const [savingEditProduct, setSavingEditProduct] = useState(false);
  
  // Member Creation State
  const [showCreateMember, setShowCreateMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [variableGroups, setVariableGroups] = useState([
    { name: '', variables: ['temp'], file_path: '', time_sampling: 1 }
  ]);
  const [savingMember, setSavingMember] = useState(false);
  const [derivingRegion, setDerivingRegion] = useState(false);

  // Member Edit/Delete State
  const [editingMember, setEditingMember] = useState(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editVariableGroups, setEditVariableGroups] = useState([]);
  const [savingEditMember, setSavingEditMember] = useState(false);
  
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Handle Authentication Login
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword.trim()) return;
    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('username', data.username);
        setToken(data.access_token);
        setUsername(data.username);
        setLoginPassword('');
      } else {
        const err = await res.json();
        setLoginError(err.detail || 'Invalid username or password');
      }
    } catch (err) {
      setLoginError('Failed to connect to authentication server.');
    } finally {
      setLoggingIn(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setToken('');
    setUsername('');
  };

  // Helper for Authenticated Fetch
  const authFetch = async (url, options = {}) => {
    const headers = {
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
      setErrorMessage('Session expired. Please log in again.');
      throw new Error('Unauthorized');
    }
    return res;
  };

  // Handle Product Update (Rename)
  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    if (!editProductName.trim() || !editingProduct) return;
    setSavingEditProduct(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await authFetch(`${API_URL}/api/products/${editingProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editProductName.trim() })
      });
      if (res.ok) {
        const updated = await res.json();
        setProducts(products.map(p => p.id === updated.id ? updated : p));
        if (selectedProduct && selectedProduct.id === updated.id) {
          setSelectedProduct(updated);
        }
        setSuccessMessage(`Product renamed to "${updated.name}" successfully.`);
        setEditingProduct(null);
        setEditProductName('');
      } else {
        const err = await res.json();
        setErrorMessage(err.detail || 'Failed to rename product.');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setErrorMessage('Network error while renaming product.');
    } finally {
      setSavingEditProduct(false);
    }
  };

  // Handle Product Delete
  const handleDeleteProduct = async (productId) => {
    if (!window.confirm("Are you sure you want to delete this product? This will also delete all of its members!")) {
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await authFetch(`${API_URL}/api/products/${productId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setProducts(products.filter(p => p.id !== productId));
        if (selectedProduct && selectedProduct.id === productId) {
          setSelectedProduct(null);
        }
        setSuccessMessage('Product and associated members deleted successfully.');
      } else {
        const err = await res.json();
        setErrorMessage(err.detail || 'Failed to delete product.');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setErrorMessage('Network error while deleting product.');
    }
  };

  // Handle Member Delete
  const handleDeleteMember = async (memberId) => {
    if (!window.confirm("Are you sure you want to delete this member?")) {
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await authFetch(`${API_URL}/api/members/${memberId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setMembers(members.filter(m => m.id !== memberId));
        setSuccessMessage('Member deleted successfully.');
      } else {
        const err = await res.json();
        setErrorMessage(err.detail || 'Failed to delete member.');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setErrorMessage('Network error while deleting member.');
    }
  };

  // Handle Member Edit Initialization
  const startEditMember = (member) => {
    setEditingMember(member);
    setEditMemberName(member.name);
    setEditVariableGroups(member.variable_groups.map(g => ({
      name: g.name || '',
      variables: [...g.variables],
      file_path: g.file_path,
      time_sampling: g.time_sampling || 1
    })));
    setErrorMessage('');
    setSuccessMessage('');
  };

  // Variable group helper functions for editing member
  const handleAddEditVariableGroup = () => {
    setEditVariableGroups([
      ...editVariableGroups,
      { name: '', variables: ['temp'], file_path: '', time_sampling: 1 }
    ]);
  };

  const handleRemoveEditVariableGroup = (idx) => {
    setEditVariableGroups(editVariableGroups.filter((_, i) => i !== idx));
  };

  const handleEditGroupNameChange = (groupIndex, name) => {
    const updated = [...editVariableGroups];
    updated[groupIndex].name = name;
    setEditVariableGroups(updated);
  };

  const handleEditVariableChange = (groupIndex, variable) => {
    const updated = [...editVariableGroups];
    const vars = updated[groupIndex].variables;
    if (vars.includes(variable)) {
      updated[groupIndex].variables = vars.filter(v => v !== variable);
    } else {
      updated[groupIndex].variables = [...vars, variable];
    }
    setEditVariableGroups(updated);
  };

  const handleEditPathChange = (groupIndex, path) => {
    const updated = [...editVariableGroups];
    updated[groupIndex].file_path = path;
    setEditVariableGroups(updated);
  };

  const handleEditTimeSamplingChange = (groupIndex, value) => {
    const updated = [...editVariableGroups];
    updated[groupIndex].time_sampling = value;
    setEditVariableGroups(updated);
  };

  // Handle Member Update Submission
  const handleUpdateMember = async (e) => {
    e.preventDefault();
    if (!editMemberName.trim() || !editingMember) {
      setErrorMessage('Member name is required.');
      return;
    }
    const invalidGroup = editVariableGroups.some(g => !g.name.trim() || !g.file_path.trim() || g.variables.length === 0);
    if (invalidGroup) {
      setErrorMessage('All variable groups must have a name, file path, and at least one variable selected.');
      return;
    }

    setSavingEditMember(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const payload = {
        name: editMemberName.trim(),
        variable_groups: editVariableGroups.map(g => ({
          name: g.name.trim(),
          variables: g.variables,
          file_path: g.file_path.trim(),
          time_sampling: g.time_sampling || 1
        }))
      };

      const res = await authFetch(`${API_URL}/api/members/${editingMember.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const updatedMember = await res.json();
        setMembers(members.map(m => m.id === updatedMember.id ? updatedMember : m));
        setSuccessMessage(`Member "${updatedMember.name}" updated successfully.`);
        setEditingMember(null);
      } else {
        const err = await res.json();
        setErrorMessage(err.detail || 'Failed to update member.');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setErrorMessage('Network error while updating member.');
    } finally {
      setSavingEditMember(false);
    }
  };

  // Fetch Products
  const fetchProducts = async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch(`${API_URL}/api/products`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
        if (data.length > 0 && !selectedProduct) {
          setSelectedProduct(data[0]);
        }
      }
    } catch (e) {
      console.error(e);
      setErrorMessage('Failed to load products.');
    } finally {
      setLoadingProducts(false);
    }
  };

  // Fetch Members for Selected Product
  const fetchMembers = async (productId) => {
    if (!productId) return;
    setLoadingMembers(true);
    try {
      const res = await fetch(`${API_URL}/api/products/${productId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
      }
    } catch (e) {
      console.error(e);
      setErrorMessage('Failed to load members.');
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (selectedProduct) {
      fetchMembers(selectedProduct.id);
      // Reset forms and messages on switching product
      setShowCreateMember(false);
      setErrorMessage('');
      setSuccessMessage('');
    } else {
      setMembers([]);
    }
  }, [selectedProduct]);

  // Handle Product Submission
  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    setSavingProduct(true);
    setErrorMessage('');
    try {
      const res = await authFetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProductName.trim() })
      });
      if (res.ok) {
        const newProd = await res.json();
        setProducts([...products, newProd]);
        setSelectedProduct(newProd);
        setNewProductName('');
        setShowCreateProduct(false);
        setSuccessMessage(`Product "${newProd.name}" created successfully.`);
      } else {
        const err = await res.json();
        setErrorMessage(err.detail || 'Failed to create product.');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setErrorMessage('Network error while creating product.');
    } finally {
      setSavingProduct(false);
    }
  };

  // Variable group helper functions
  const handleAddVariableGroup = () => {
    setVariableGroups([
      ...variableGroups,
      { name: '', variables: ['temp'], file_path: '', time_sampling: 1 }
    ]);
  };

  const handleRemoveVariableGroup = (idx) => {
    setVariableGroups(variableGroups.filter((_, i) => i !== idx));
  };

  const handleGroupNameChange = (groupIndex, name) => {
    const updated = [...variableGroups];
    updated[groupIndex].name = name;
    setVariableGroups(updated);
  };

  const handleVariableChange = (groupIndex, variable) => {
    const updated = [...variableGroups];
    const vars = updated[groupIndex].variables;
    if (vars.includes(variable)) {
      updated[groupIndex].variables = vars.filter(v => v !== variable);
    } else {
      updated[groupIndex].variables = [...vars, variable];
    }
    setVariableGroups(updated);
  };

  const handlePathChange = (groupIndex, path) => {
    const updated = [...variableGroups];
    updated[groupIndex].file_path = path;
    setVariableGroups(updated);
  };

  const handleTimeSamplingChange = (groupIndex, value) => {
    const updated = [...variableGroups];
    updated[groupIndex].time_sampling = value;
    setVariableGroups(updated);
  };

  // Handle Member Submission
  const handleCreateMember = async (e) => {
    e.preventDefault();
    if (!newMemberName.trim()) {
      setErrorMessage('Member name is required.');
      return;
    }
    // Check fields are not empty
    const invalidGroup = variableGroups.some(g => !g.name.trim() || !g.file_path.trim() || g.variables.length === 0);
    if (invalidGroup) {
      setErrorMessage('All variable groups must have a name, file path, and at least one variable selected.');
      return;
    }

    setSavingMember(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const payload = {
        name: newMemberName.trim(),
        variable_groups: variableGroups.map(g => ({
          name: g.name.trim(),
          variables: g.variables,
          file_path: g.file_path.trim(),
          time_sampling: g.time_sampling || 1
        }))
      };

      const res = await authFetch(`${API_URL}/api/products/${selectedProduct.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const newMember = await res.json();
        setMembers([...members, newMember]);
        setNewMemberName('');
        setVariableGroups([{ name: '', variables: ['temp'], file_path: '', time_sampling: 1 }]);
        setShowCreateMember(false);
        setSuccessMessage(`Member "${newMember.name}" registered and NetCDF dimensions extracted successfully.`);
      } else {
        const err = await res.json();
        setErrorMessage(err.detail || 'Failed to register member.');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setErrorMessage('Network error while registering member.');
    } finally {
      setSavingMember(false);
    }
  };

  const handleDeriveRegion = async () => {
    if (!selectedProduct) return;
    setDerivingRegion(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await authFetch(`${API_URL}/api/products/${selectedProduct.id}/derive_region`, {
        method: 'POST'
      });
      if (res.ok) {
        const updatedProduct = await res.json();
        setProducts(products.map(p => p.id === updatedProduct.id ? updatedProduct : p));
        setSelectedProduct(updatedProduct);
        setSuccessMessage(`Bounding shape derived for "${updatedProduct.name}" successfully.`);
      } else {
        const err = await res.json();
        setErrorMessage(err.detail || 'Failed to derive bounding shape.');
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setErrorMessage('Network error while deriving bounding shape.');
    } finally {
      setDerivingRegion(false);
    }
  };

  const getBBox = (region) => {
    if (!region || !region.coordinates) return null;
    let coords = [];
    if (region.type === 'Polygon') {
      coords = region.coordinates.flat();
    } else if (region.type === 'MultiPolygon') {
      coords = region.coordinates.flat(2);
    }
    
    if (coords.length === 0) return null;
    
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    
    coords.forEach(pt => {
      if (Array.isArray(pt) && pt.length >= 2) {
        const [lng, lat] = pt;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    });
    
    return { minLng, maxLng, minLat, maxLat, count: coords.length };
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center relative font-sans antialiased p-4">
        {/* Background Ambient Glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-sky-500/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/80 border border-slate-800/80 backdrop-blur-xl rounded-2xl p-8 shadow-2xl z-10 relative">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-12 h-12 bg-gradient-to-tr from-sky-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              SOMISANA Ocean Visualizer
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Admin Portal Authentication
            </p>
          </div>

          {loginError && (
            <div className="mb-6 p-3 bg-red-950/50 border border-red-800/60 rounded-xl flex items-center gap-2.5 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="Enter administrator username"
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Enter administrator password"
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-all"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-sky-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  <span>Log In to Admin Portal</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800/80 flex justify-center">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Public Dashboard</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Top Navbar */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-slate-100 transition-colors"
            title="Back to Visualizer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 bg-clip-text text-transparent">
              Ocean Visualizer Admin
            </h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
              Manage Products & Child Model Members
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300">
            <User className="w-3.5 h-3.5 text-sky-400" />
            <span>Administrator: <strong className="text-white">{username}</strong></span>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/40 hover:bg-red-900/50 border border-red-800/60 rounded-lg text-xs font-semibold text-red-300 hover:text-red-100 transition-all"
            title="Log Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
          <button 
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-xs font-semibold rounded-lg text-slate-300 hover:text-white transition-all border border-slate-800 hover:border-slate-700"
          >
            View Map Dashboard
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Products List */}
        <aside className="w-80 border-r border-slate-900 bg-slate-950 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-900/60 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Products (Regions)</span>
            {!showCreateProduct && (
              <button 
                onClick={() => setShowCreateProduct(true)}
                className="p-1.5 bg-sky-600 hover:bg-sky-500 rounded text-slate-100 transition-all flex items-center justify-center"
                title="Create Product"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* Create Product Form Card */}
            {showCreateProduct && (
              <form onSubmit={handleCreateProduct} className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-bold text-sky-400">New Product</div>
                <input 
                  type="text" 
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="e.g. Algoa Bay"
                  className="w-full text-xs bg-slate-950 border border-slate-800 focus:border-sky-500 rounded px-2.5 py-2 text-slate-200 outline-none"
                  autoFocus
                  required
                />
                <div className="flex justify-end gap-1.5">
                  <button 
                    type="button" 
                    onClick={() => { setShowCreateProduct(false); setNewProductName(''); }}
                    className="px-2.5 py-1.5 hover:bg-slate-800 text-[10px] font-semibold text-slate-400 rounded transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={savingProduct}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-[10px] font-semibold text-white rounded transition-all flex items-center gap-1 disabled:opacity-50"
                  >
                    {savingProduct ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Save
                  </button>
                </div>
              </form>
            )}

            {loadingProducts ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-xs gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
                Loading Products...
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12 text-slate-600 text-xs">
                No products found. Create one to get started!
              </div>
            ) : (
              products.map((prod) => (
                <button
                  key={prod.id}
                  onClick={() => setSelectedProduct(prod)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 ${
                    selectedProduct?.id === prod.id 
                      ? 'bg-slate-900 border-sky-500/50 shadow-lg shadow-sky-500/5 text-slate-100 font-medium' 
                      : 'bg-slate-900/30 hover:bg-slate-900/60 border-slate-900 hover:border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Folder className={`w-4 h-4 ${selectedProduct?.id === prod.id ? 'text-sky-400' : 'text-slate-500'}`} />
                    <span className="text-xs truncate">{prod.name}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Right Column: Selected Product Members Area */}
        <main className="flex-1 bg-slate-950 flex flex-col overflow-y-auto p-8 space-y-6">
          {/* Banner Messages */}
          {errorMessage && (
            <div className="p-4 bg-red-950/40 border border-red-900/80 text-red-200 rounded-xl flex gap-3 items-start text-xs backdrop-blur">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <div className="font-mono whitespace-pre-wrap">{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="p-4 bg-emerald-950/40 border border-emerald-900/80 text-emerald-200 rounded-xl flex gap-3 items-start text-xs backdrop-blur">
              <Check className="w-4 h-4 shrink-0 text-emerald-500" />
              <div>{successMessage}</div>
            </div>
          )}

          {selectedProduct ? (
            <div className="space-y-6">
              {/* Product Header Card */}
              <div className="p-6 bg-slate-900/30 border border-slate-900 rounded-2xl flex items-center justify-between">
                <div>
                  {editingProduct && editingProduct.id === selectedProduct.id ? (
                    <form onSubmit={handleUpdateProduct} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editProductName}
                        onChange={(e) => setEditProductName(e.target.value)}
                        className="text-xl font-extrabold text-slate-100 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 outline-none focus:border-sky-500"
                        autoFocus
                        required
                      />
                      <button
                        type="submit"
                        disabled={savingEditProduct}
                        className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded transition flex items-center justify-center animate-none"
                        title="Save Name"
                      >
                        {savingEditProduct ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingProduct(null); setEditProductName(''); }}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded transition"
                        title="Cancel"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-extrabold text-slate-100">{selectedProduct.name}</h2>
                      <button
                        onClick={() => { setEditingProduct(selectedProduct); setEditProductName(selectedProduct.name); }}
                        className="p-1 text-slate-500 hover:text-slate-200 transition-all rounded"
                        title="Rename Product"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(selectedProduct.id)}
                        className="p-1 text-slate-500 hover:text-red-400 transition-all rounded"
                        title="Delete Product"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
                    Product ID: <span className="font-mono text-slate-400">{selectedProduct.id}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDeriveRegion}
                    disabled={members.length === 0 || derivingRegion}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 hover:text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-800 disabled:hover:text-slate-500"
                    title={members.length === 0 ? "Add at least one member to derive the bounding shape" : "Derive spatial bounding polygon from first member grid"}
                  >
                    {derivingRegion ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Deriving...
                      </>
                    ) : (
                      <>
                        <Compass className="w-3.5 h-3.5 text-sky-400" />
                        Derive Bounding Shape
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowCreateMember(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white rounded-lg shadow-lg hover:shadow-sky-500/10 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Add Member
                  </button>
                </div>
              </div>

              {/* Bounding Shape Display Card */}
              {(() => {
                const bbox = selectedProduct.region ? getBBox(selectedProduct.region) : null;
                return selectedProduct.region ? (
                  <div className="p-5 bg-indigo-950/10 border border-indigo-900/30 rounded-2xl space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-indigo-400">
                      <Compass className="w-4.5 h-4.5 text-indigo-400" />
                      <span>Derived Bounding Shape (Region Outline)</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Geometry Type</span>
                        <div className="font-mono text-slate-200">
                          {selectedProduct.region.type} ({bbox?.count || 0} vertices)
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Bounding Box (WGS84)</span>
                        <div className="font-mono text-slate-200">
                          {bbox ? (
                            <span>
                              {bbox.minLng.toFixed(4)}°E to {bbox.maxLng.toFixed(4)}°E,{' '}
                              {bbox.minLat.toFixed(4)}°S to {bbox.maxLat.toFixed(4)}°S
                            </span>
                          ) : (
                            'N/A'
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 bg-slate-900/10 border border-dashed border-slate-900 rounded-2xl text-slate-500 text-xs text-center">
                    No bounding shape derived for this product yet. Click "Derive Bounding Shape" above.
                  </div>
                );
              })()}

              {/* Member Creation Modal Overlay */}
              {showCreateMember && (
                <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <form 
                    onSubmit={handleCreateMember} 
                    className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl p-6 space-y-5 flex flex-col max-h-[90vh] overflow-hidden"
                  >
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">Add Member Model</h3>
                      <p className="text-xs text-slate-500">
                        Create a child model output under {selectedProduct.name}. Path coordinates will be auto-scanned.
                      </p>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                      {/* Name input */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Member Name</label>
                        <input 
                          type="text"
                          value={newMemberName}
                          onChange={(e) => setNewMemberName(e.target.value)}
                          placeholder="e.g. CROCO 10-day Average Model"
                          className="w-full text-xs bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-slate-200 outline-none"
                          required
                        />
                      </div>

                      {/* Variable Groups */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Variable Groups</label>
                          <button
                            type="button"
                            onClick={handleAddVariableGroup}
                            className="flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Group File
                          </button>
                        </div>

                        <div className="space-y-3.5">
                          {variableGroups.map((group, gIdx) => (
                            <div key={gIdx} className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-3 relative">
                              {variableGroups.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveVariableGroup(gIdx)}
                                  className="absolute top-3 right-3 p-1 hover:bg-slate-900 rounded text-slate-500 hover:text-red-400 transition-all"
                                  title="Remove Group"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Group Name and NetCDF Path input */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                <div className="space-y-1.5">
                                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Variable Group Name</span>
                                  <input 
                                    type="text"
                                    value={group.name}
                                    onChange={(e) => handleGroupNameChange(gIdx, e.target.value)}
                                    placeholder="e.g. Temperature / Salinity / Currents"
                                    className="w-full text-xs bg-slate-900 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-slate-200 outline-none"
                                    required
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <span className="text-[10px] text-slate-500 uppercase font-semibold">NetCDF (.nc) Absolute Path</span>
                                  <input 
                                    type="text"
                                    value={group.file_path}
                                    onChange={(e) => handlePathChange(gIdx, e.target.value)}
                                    placeholder="e.g. /home/dylan/srv/ocean_model_visualiser/croco_avg_t2.nc"
                                    className="w-full text-xs bg-slate-900 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-slate-200 outline-none font-mono"
                                    required
                                  />
                                </div>
                              </div>

                              {/* Checkbox Variables selection */}
                              <div className="space-y-1.5">
                                <span className="text-[10px] text-slate-500 uppercase font-semibold">Supported Variables</span>
                                <div className="flex flex-wrap gap-3 mt-1">
                                  {['temp', 'salt', 'currents', 'zeta'].map((v) => (
                                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300">
                                      <input 
                                        type="checkbox"
                                        checked={group.variables.includes(v)}
                                        onChange={() => handleVariableChange(gIdx, v)}
                                        className="rounded border-slate-800 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                                      />
                                      {v === 'temp' ? 'Temperature' : v === 'salt' ? 'Salinity' : v === 'currents' ? 'Currents' : 'Sea Surface Height (zeta)'}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              {/* Time steps to sample selection */}
                              <div className="space-y-1.5">
                                <span className="text-[10px] text-slate-500 uppercase font-semibold">Time steps to sample</span>
                                <div className="flex flex-wrap gap-4 mt-1">
                                  {[1, 2, 4, 6].map((val) => (
                                    <label key={val} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300">
                                      <input 
                                        type="checkbox"
                                        checked={(group.time_sampling || 1) === val}
                                        onChange={() => handleTimeSamplingChange(gIdx, val)}
                                        className="rounded border-slate-800 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                                      />
                                      {val === 1 ? 'Every time step (1)' : `Every ${val} steps`}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-800/80 pt-4 flex justify-end gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateMember(false);
                          setNewMemberName('');
                          setVariableGroups([{ variables: ['temp'], file_path: '' }]);
                          setErrorMessage('');
                        }}
                        className="px-4 py-2 hover:bg-slate-800 text-xs font-semibold text-slate-400 rounded-lg transition-all"
                        disabled={savingMember}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingMember}
                        className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white rounded-lg shadow-lg hover:shadow-sky-500/10 transition-all flex items-center gap-1.5 disabled:opacity-60"
                      >
                        {savingMember ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Scanning NetCDF...
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Create Member
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Member Edit Modal Overlay */}
              {editingMember && (
                <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <form 
                    onSubmit={handleUpdateMember} 
                    className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl p-6 space-y-5 flex flex-col max-h-[90vh] overflow-hidden"
                  >
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">Edit Member Model</h3>
                      <p className="text-xs text-slate-500">
                        Update name or files for {editingMember.name}. Changed paths will be scanned again.
                      </p>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                      {/* Name input */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Member Name</label>
                        <input 
                          type="text"
                          value={editMemberName}
                          onChange={(e) => setEditMemberName(e.target.value)}
                          placeholder="e.g. CROCO 10-day Average Model"
                          className="w-full text-xs bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-slate-200 outline-none"
                          required
                        />
                      </div>

                      {/* Variable Groups */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Variable Groups</label>
                          <button
                            type="button"
                            onClick={handleAddEditVariableGroup}
                            className="flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Group File
                          </button>
                        </div>

                        <div className="space-y-3.5">
                          {editVariableGroups.map((group, gIdx) => (
                            <div key={gIdx} className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-3 relative">
                              {editVariableGroups.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveEditVariableGroup(gIdx)}
                                  className="absolute top-3 right-3 p-1 hover:bg-slate-900 rounded text-slate-500 hover:text-red-400 transition-all"
                                  title="Remove Group"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Group Name and NetCDF Path input */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                <div className="space-y-1.5">
                                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Variable Group Name</span>
                                  <input 
                                    type="text"
                                    value={group.name}
                                    onChange={(e) => handleEditGroupNameChange(gIdx, e.target.value)}
                                    placeholder="e.g. Temperature / Salinity / Currents"
                                    className="w-full text-xs bg-slate-900 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-slate-200 outline-none"
                                    required
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <span className="text-[10px] text-slate-500 uppercase font-semibold">NetCDF (.nc) Absolute Path</span>
                                  <input 
                                    type="text"
                                    value={group.file_path}
                                    onChange={(e) => handleEditPathChange(gIdx, e.target.value)}
                                    placeholder="e.g. /home/dylan/srv/ocean_model_visualiser/croco_avg_t2.nc"
                                    className="w-full text-xs bg-slate-900 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-slate-200 outline-none font-mono"
                                    required
                                  />
                                </div>
                              </div>

                              {/* Checkbox Variables selection */}
                              <div className="space-y-1.5">
                                <span className="text-[10px] text-slate-500 uppercase font-semibold">Supported Variables</span>
                                <div className="flex flex-wrap gap-3 mt-1">
                                  {['temp', 'salt', 'currents', 'zeta'].map((v) => (
                                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300">
                                      <input 
                                        type="checkbox"
                                        checked={group.variables.includes(v)}
                                        onChange={() => handleEditVariableChange(gIdx, v)}
                                        className="rounded border-slate-800 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                                      />
                                      {v === 'temp' ? 'Temperature' : v === 'salt' ? 'Salinity' : v === 'currents' ? 'Currents' : 'Sea Surface Height (zeta)'}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              {/* Time steps to sample selection */}
                              <div className="space-y-1.5">
                                <span className="text-[10px] text-slate-500 uppercase font-semibold">Time steps to sample</span>
                                <div className="flex flex-wrap gap-4 mt-1">
                                  {[1, 2, 4, 6].map((val) => (
                                    <label key={val} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300">
                                      <input 
                                        type="checkbox"
                                        checked={(group.time_sampling || 1) === val}
                                        onChange={() => handleEditTimeSamplingChange(gIdx, val)}
                                        className="rounded border-slate-800 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                                      />
                                      {val === 1 ? 'Every time step (1)' : `Every ${val} steps`}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-800/80 pt-4 flex justify-end gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMember(null);
                          setErrorMessage('');
                        }}
                        className="px-4 py-2 hover:bg-slate-800 text-xs font-semibold text-slate-400 rounded-lg transition-all"
                        disabled={savingEditMember}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingEditMember}
                        className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white rounded-lg shadow-lg hover:shadow-sky-500/10 transition-all flex items-center gap-1.5 disabled:opacity-60"
                      >
                        {savingEditMember ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Re-scanning NetCDF...
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Save Changes
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Members List Section */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Model Outputs (Members)</h3>
                
                {loadingMembers ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-xs gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
                    Loading members for {selectedProduct.name}...
                  </div>
                ) : members.length === 0 ? (
                  <div className="p-8 text-center bg-slate-900/10 border border-dashed border-slate-900 rounded-2xl text-slate-500 text-xs">
                    No members registered under this product. Click "Add Member" to scan and link one!
                  </div>
                ) : (
                  <div className="space-y-4">
                    {members.map((member) => (
                      <div key={member.id} className="p-6 bg-slate-900/20 border border-slate-900 rounded-2xl space-y-4">
                        {/* Member Header */}
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="text-sm font-bold text-slate-200">{member.name}</h4>
                            <p className="text-[10px] text-slate-500 uppercase font-mono mt-0.5">ID: {member.id}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => startEditMember(member)}
                              className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-400 hover:text-slate-200 rounded-md transition-all flex items-center justify-center"
                              title="Edit Member"
                            >
                              <Pencil className="w-3.5 h-3.5 text-slate-400" />
                            </button>
                            <button
                              onClick={() => handleDeleteMember(member.id)}
                              className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-400 hover:text-red-400 rounded-md transition-all flex items-center justify-center"
                              title="Delete Member"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                            </button>
                            <span className="px-2.5 py-0.5 bg-sky-500/10 border border-sky-500/30 text-sky-400 text-[10px] rounded-full font-bold uppercase tracking-wider">
                              Active
                            </span>
                          </div>
                        </div>

                        {/* File details list */}
                        <div className="space-y-4 bg-slate-950/40 p-4 border border-slate-900/80 rounded-xl text-xs">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sources & Variables</div>
                          {member.variable_groups.map((g, gIdx) => (
                            <div key={gIdx} className="space-y-2 border-b border-slate-900/60 pb-3 last:border-b-0 last:pb-0">
                              <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px] truncate">
                                <FileText className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                                <span className="text-slate-100 font-medium">{g.file_path}</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5 pl-5">
                                {g.variables.map(v => (
                                  <span key={v} className="px-2 py-0.5 bg-slate-900 text-[10px] rounded text-slate-400 border border-slate-800">
                                    {v === 'temp' ? 'Temperature' : v === 'salt' ? 'Salinity' : v === 'currents' ? 'Currents' : 'Sea Surface Height (zeta)'}
                                  </span>
                                ))}
                              </div>
                              
                              {/* Depths & Time steps for this variable group */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-5 mt-1.5">
                                <div className="p-2 bg-slate-900/40 rounded-lg space-y-0.5 border border-slate-900/60">
                                  <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-wider font-semibold">
                                    <Layers className="w-3 h-3 text-sky-400" />
                                    <span>Depths ({g.depths?.length || 0})</span>
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-300 truncate" title={g.depths ? g.depths.join(', ') : ''}>
                                    {g.depths && g.depths.length > 0 ? `[${g.depths.join(', ')}]` : 'No depth dimensions'}
                                  </div>
                                </div>

                                <div className="p-2 bg-slate-900/40 rounded-lg space-y-0.5 border border-slate-900/60">
                                  <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-wider font-semibold">
                                    <Clock className="w-3 h-3 text-indigo-400" />
                                    <span>Time Steps ({g.time_steps?.length || 0})</span>
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-300 truncate">
                                    {g.time_steps && g.time_steps.length > 0 ? (
                                      <span>
                                        {new Date(g.time_steps[0]).toLocaleDateString()} - {new Date(g.time_steps[g.time_steps.length - 1]).toLocaleDateString()}
                                      </span>
                                    ) : (
                                      'No time dimensions'
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-20 text-slate-600 space-y-2">
              <Folder className="w-12 h-12 text-slate-800" />
              <div className="text-sm font-bold text-slate-500">No Product Selected</div>
              <div className="text-xs max-w-xs">
                Select an existing product from the left panel or create a new one to manage its model members.
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
