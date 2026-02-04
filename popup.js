// Backend configuration
const BACKEND_URL = 'https://wati-backend.wati-sales-system.workers.dev';

// Custom message dialog
function showCustomMessage(title, message) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background: white; padding: 20px; border-radius: 8px; max-width: 300px; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
    
    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    titleEl.style.cssText = 'margin: 0 0 10px 0; color: #d32f2f; font-size: 16px;';
    
    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.cssText = 'margin: 0 0 15px 0; color: #333; font-size: 14px;';
    
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'background: #4285f4; color: white; border: none; padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;';
    okBtn.onclick = () => overlay.remove();
    
    dialog.appendChild(titleEl);
    dialog.appendChild(messageEl);
    dialog.appendChild(okBtn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

// Load current sender and team members on popup open
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    setupEventListeners();
});

// Check if user is logged in
function checkAuthStatus() {
    chrome.storage.sync.get(['userAuth'], (result) => {
        const userAuth = result.userAuth;
        
        if (userAuth && userAuth.email) {
            // User is logged in
            showUserSection(userAuth);
            loadCurrentCustomer();
        } else {
            // User not logged in
            showLoginSection();
        }
    });
}

// Show login section
function showLoginSection() {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('userSection').style.display = 'none';
}

// Show user section
function showUserSection(userAuth) {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('userSection').style.display = 'block';
    
    // Start heartbeat if not already running
    if (userAuth.userId && !heartbeatInterval) {
        startHeartbeat(userAuth.userId);
    }
    
    const displayName = userAuth.name || (userAuth.email ? userAuth.email.split('@')[0] : 'User');
    document.getElementById('userName').textContent = displayName;
    document.getElementById('userEmail').textContent = userAuth.email || '';
    document.getElementById('userId').textContent = userAuth.userId || '';
    
    // Show control panel button only for admins
    const controlPanelBtn = document.getElementById('controlPanelBtn');
    if (controlPanelBtn) {
        controlPanelBtn.style.display = userAuth.role === 'admin' ? 'block' : 'none';
    }
}

// Email/Password login
async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const statusDiv = document.getElementById('loginStatus');
    
    if (!email || !password) {
        showLoginStatus('Please enter email and password', true);
        return;
    }
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            showLoginStatus(data.error || 'Login failed', true);
            return;
        }
        
        // Store user auth
        const userAuth = {
            email: data.email,
            name: data.name || email.split('@')[0],
            userId: data.userId,
            role: data.role || 'agent'  // Store role from backend
        };
        
        chrome.storage.sync.set({ userAuth, currentSender: userAuth.name }, () => {
            showUserSection(userAuth);
            showLoginStatus(`✓ Logged in as ${userAuth.name}`, false);
            
            // Start heartbeat to keep user online
            startHeartbeat(userAuth.userId);
            
            // Clear form
            document.getElementById('loginEmail').value = '';
            document.getElementById('loginPassword').value = '';
            
            // Notify content script
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { 
                        action: 'senderChanged', 
                        sender: userAuth.name 
                    }).catch(() => {});
                });
            });
        });
        
    } catch (error) {
        console.error('Login error:', error);
        showLoginStatus('Network error: ' + error.message, true);
    }
}

// Sign up
function handleSignup() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    
    if (!email || !password) {
        showLoginStatus('Please enter email and password', true);
        return;
    }
    
    // For now, show a message. You can expand this with signup validation
    const name = email.split('@')[0];
    showLoginStatus('Signing up...', false);
    
    fetch(`${BACKEND_URL}/api/users/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            showLoginStatus(data.error, true);
            return;
        }
        
        showLoginStatus('✓ Account created! Please sign in.', false);
        document.getElementById('loginPassword').value = '';
    })
    .catch(error => showLoginStatus('Signup error: ' + error.message, true));
}

// Logout
function handleLogout() {
    // Stop heartbeat
    stopHeartbeat();
    
    // Get user ID before clearing storage
    chrome.storage.sync.get(['userAuth'], async (result) => {
        if (result.userAuth && result.userAuth.userId) {
            // Notify backend that user is logging out
            try {
                await fetch(`${BACKEND_URL}/api/users/logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: result.userAuth.userId })
                });
            } catch (error) {
                console.error('Failed to update logout status:', error);
            }
        }
    });
    
    chrome.storage.sync.remove(['userAuth', 'currentSender'], () => {
        showLoginSection();
        
        // Clear form
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
        
        // Notify content script
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: 'senderChanged', 
                    sender: '' 
                }).catch(() => {});
            });
        });
    });
}

// Heartbeat to keep user online
let heartbeatInterval = null;

function startHeartbeat(userId) {
    // Clear any existing interval
    stopHeartbeat();
    
    // Send heartbeat every 30 seconds
    heartbeatInterval = setInterval(async () => {
        try {
            await fetch(`${BACKEND_URL}/api/users/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
        } catch (error) {
            console.error('Heartbeat failed:', error);
        }
    }, 30000); // 30 seconds
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

async function loadSystemStats() {
    try {
        // Load users stats
        const usersResponse = await fetch(`${BACKEND_URL}/api/users/list`);
        if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            const users = usersData.users || [];
            document.getElementById('statTotalUsers').textContent = users.length;
            document.getElementById('statOnlineUsers').textContent = users.filter(u => u.online_status === 'online').length;
        }
        
        // Load customer stats (you can add a backend endpoint for this)
        document.getElementById('statTotalCustomers').textContent = '-';
        document.getElementById('statMessagesToday').textContent = '-';
        
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Show edit name form
function showEditNameForm() {
    document.getElementById('editNameBtn').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('editNameForm').style.display = 'block';
    
    // Pre-fill with current name
    chrome.storage.sync.get(['userAuth'], (result) => {
        if (result.userAuth && result.userAuth.name) {
            document.getElementById('newNameInput').value = result.userAuth.name;
        }
    });
}

// Cancel edit name
function cancelEditName() {
    document.getElementById('editNameBtn').style.display = 'block';
    document.getElementById('logoutBtn').style.display = 'block';
    document.getElementById('editNameForm').style.display = 'none';
    document.getElementById('newNameInput').value = '';
    document.getElementById('oldPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('confirmPasswordInput').value = '';
}

// Save new name and password
async function saveNewName() {
    const newName = document.getElementById('newNameInput').value.trim();
    const oldPassword = document.getElementById('oldPasswordInput').value.trim();
    const newPassword = document.getElementById('newPasswordInput').value.trim();
    const confirmPassword = document.getElementById('confirmPasswordInput').value.trim();
    
    if (!newName) {
        showStatus('Name cannot be empty', true);
        return;
    }
    
    chrome.storage.sync.get(['userAuth'], async (result) => {
        if (!result.userAuth) return;
        
        let nameChanged = false;
        let passwordChanged = false;
        
        // Update name if changed
        if (newName !== result.userAuth.name) {
            try {
                const response = await fetch(`${BACKEND_URL}/api/users/name`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        userId: result.userAuth.userId,
                        name: newName 
                    })
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    showStatus(data.error || 'Failed to update name', true);
                    return;
                }
                
                result.userAuth.name = newName;
                nameChanged = true;
            } catch (error) {
                console.error('Update name error:', error);
                showStatus('Network error: ' + error.message, true);
                return;
            }
        }
        
        // Update password if provided
        if (oldPassword && newPassword) {
            if (newPassword !== confirmPassword) {
                showStatus('New passwords do not match', true);
                return;
            }
            
            if (newPassword.length < 6) {
                showStatus('Password must be at least 6 characters', true);
                return;
            }
            
            try {
                const response = await fetch(`${BACKEND_URL}/api/users/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        userId: result.userAuth.userId,
                        oldPassword: oldPassword,
                        newPassword: newPassword
                    })
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    showStatus(data.error || 'Failed to update password', true);
                    return;
                }
                
                passwordChanged = true;
            } catch (error) {
                console.error('Update password error:', error);
                showStatus('Network error: ' + error.message, true);
                return;
            }
        }
        
        // If nothing changed
        if (!nameChanged && !passwordChanged) {
            showStatus('No changes to save', true);
            return;
        }
        
        // Save and notify
        chrome.storage.sync.set({ userAuth: result.userAuth, currentSender: result.userAuth.name }, () => {
            showUserSection(result.userAuth);
            cancelEditName();
            
            let message = '✓ Profile updated';
            if (nameChanged && passwordChanged) {
                message = '✓ Name and password updated';
            } else if (nameChanged) {
                message = `✓ Name updated to ${result.userAuth.name}`;
            } else if (passwordChanged) {
                message = '✓ Password updated';
            }
            
            showStatus(message, false);
            
            // Notify content script if name changed
            if (nameChanged) {
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, { 
                            action: 'senderChanged', 
                            sender: result.userAuth.name 
                        }).catch(() => {});
                    });
                });
            }
        });
    });
}

function setupEventListeners() {
    // Login/Signup/Logout
    const loginBtn = document.getElementById('loginBtn');
    const signupBtn = document.getElementById('signupBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }
    if (signupBtn) {
        signupBtn.addEventListener('click', handleSignup);
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Edit name
    const editNameBtn = document.getElementById('editNameBtn');
    const saveNameBtn = document.getElementById('saveNameBtn');
    const cancelEditNameBtn = document.getElementById('cancelEditNameBtn');
    const newNameInput = document.getElementById('newNameInput');
    
    if (editNameBtn) {
        editNameBtn.addEventListener('click', showEditNameForm);
    }
    if (saveNameBtn) {
        saveNameBtn.addEventListener('click', saveNewName);
    }
    if (cancelEditNameBtn) {
        cancelEditNameBtn.addEventListener('click', cancelEditName);
    }
    if (newNameInput) {
        newNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveNewName();
            }
        });
    }
    
    // Refresh customer
    const refreshCustomerBtn = document.getElementById('refreshCustomerBtn');
    if (refreshCustomerBtn) {
        refreshCustomerBtn.addEventListener('click', loadCurrentCustomer);
    }
    
    // Control panel listeners
    const controlPanelBtn = document.getElementById('controlPanelBtn');
    if (controlPanelBtn) {
        controlPanelBtn.addEventListener('click', showControlPanel);
    }
    
    const backFromControlPanel = document.getElementById('backFromControlPanel');
    if (backFromControlPanel) {
        backFromControlPanel.addEventListener('click', hideControlPanel);
    }
    
    const refreshStatsBtn = document.getElementById('refreshStatsBtn');
    if (refreshStatsBtn) {
        refreshStatsBtn.addEventListener('click', loadSystemStats);
    }
    
    // Enter key on email/password
    if (loginEmail && loginPassword) {
        loginPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });
    }
}

// Load current customer info from WATI
function loadCurrentCustomer() {
    console.log('loadCurrentCustomer called');
    // Query for active WATI tab - match all WATI subdomains
    chrome.tabs.query({ url: 'https://*.wati.io/*' }, (tabs) => {
        console.log('Found WATI tabs:', tabs.length);
        if (tabs.length === 0) {
            console.log('No WATI tabs found');
            showCustomerInfo(null);
            return;
        }
        
        console.log('Sending getCurrentCustomer message to tab:', tabs[0].id);
        // Send message to content script to get current customer
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getCurrentCustomer' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting customer:', chrome.runtime.lastError.message);
                // Show helpful error message
                const customerInfo = document.getElementById('customerInfo');
                const customerDetails = document.getElementById('customerDetails');
                if (customerInfo) {
                    customerInfo.style.display = 'block';
                    customerInfo.innerHTML = `
                        <div style="padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; text-align: center;">
                            <div style="font-size: 13px; color: #856404; margin-bottom: 8px;">⚠️ Extension needs refresh</div>
                            <div style="font-size: 11px; color: #856404; margin-bottom: 10px;">Please refresh the WATI page</div>
                            <button id="refreshWatiPage" style="padding: 6px 12px; background: #ffc107; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">
                                🔄 Refresh WATI Page
                            </button>
                        </div>
                    `;
                    
                    // Add click handler for refresh button
                    setTimeout(() => {
                        const refreshBtn = document.getElementById('refreshWatiPage');
                        if (refreshBtn) {
                            refreshBtn.addEventListener('click', () => {
                                chrome.tabs.reload(tabs[0].id, () => {
                                    setTimeout(() => loadCurrentCustomer(), 1000);
                                });
                            });
                        }
                    }, 100);
                }
                if (customerDetails) {
                    customerDetails.style.display = 'none';
                }
                return;
            }
            
            console.log('Received customer response:', response);
            showCustomerInfo(response);
        });
    });
}

// Display customer info
function showCustomerInfo(customer) {
    const customerInfo = document.getElementById('customerInfo');
    const customerDetails = document.getElementById('customerDetails');
    
    if (!customer || !customer.phone) {
        customerInfo.style.display = 'block';
        customerDetails.style.display = 'none';
        customerInfo.innerHTML = '<div style="font-size: 13px; color: #999;">Open a chat in WATI to see customer info</div>';
        return;
    }
    
    customerInfo.style.display = 'none';
    customerDetails.style.display = 'block';
    document.getElementById('customerPhone').textContent = customer.phone || 'Unknown';
    document.getElementById('customerName').textContent = customer.name || 'Unknown';
    
    const defaultSalesEl = document.getElementById('customerDefaultSales');
    defaultSalesEl.textContent = customer.defaultSales || 'Not assigned';
    
    // Make it visually obvious that Default Sales is clickable
    defaultSalesEl.style.cursor = 'pointer';
    defaultSalesEl.style.color = '#4285f4';
    defaultSalesEl.style.textDecoration = 'underline';
    defaultSalesEl.style.fontWeight = '600';
    
    // Add click handler to change default sales
    defaultSalesEl.onclick = () => {
        console.log('Default Sales clicked:', customer);
        changeDefaultSales(customer.phone, customer.defaultSales, customer.defaultSalesId, customer.watiChatId);
    };
    
    // Status is displayed but changed on WATI page via the dropdown
    const statusEl = document.getElementById('customerStatus');
    statusEl.textContent = customer.status || 'No status';
    statusEl.style.fontStyle = customer.status ? 'normal' : 'italic';
    statusEl.style.color = customer.status ? '#333' : '#999';
}

// Change default sales
async function changeDefaultSales(phone, currentDefaultSales, currentDefaultSalesId, watiChatId) {
    if (!phone) return;
    
    // Get current user
    chrome.storage.sync.get(['userAuth'], async (result) => {
        if (!result.userAuth) {
            alert('Please login first');
            return;
        }
        
        const currentUserId = result.userAuth.userId;
        const userRole = result.userAuth.role || 'agent';
        
        // Check permission: only admin or current default sales can change
        const isAdmin = userRole === 'admin';
        const isCurrentDefaultSales = currentDefaultSalesId && currentDefaultSalesId === currentUserId;
        
        if (!isAdmin && !isCurrentDefaultSales) {
            showCustomMessage('Permission Denied', 'Only admin or current Default Sales can make changes.');
            return;
        }
        
        // Fetch all users from backend
        try {
            const response = await fetch(`${BACKEND_URL}/api/users/list`);
            if (!response.ok) {
                alert('Failed to load users list');
                return;
            }
            
            const data = await response.json();
            const users = data.users || [];
            
            if (users.length === 0) {
                alert('No users found');
                return;
            }
            
            // Show user selection modal
            showUserSelectionModal(users, currentDefaultSales, (selectedUser) => {
                if (selectedUser) {
                    updateDefaultSales(phone, selectedUser.name, selectedUser.id, watiChatId);
                }
            });
        } catch (error) {
            console.error('Error fetching users:', error);
            alert('Network error: ' + error.message);
        }
    });
}

// Show user selection modal
function showUserSelectionModal(users, currentDefaultSales, callback) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;
    
    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 20px;
        width: 300px;
        max-height: 400px;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    
    // Title
    const title = document.createElement('h3');
    title.textContent = 'Select Default Sales';
    title.style.cssText = 'margin: 0 0 15px 0; font-size: 16px; color: #333;';
    modal.appendChild(title);
    
    // User list
    users.forEach(user => {
        const userOption = document.createElement('div');
        userOption.style.cssText = `
            padding: 10px;
            margin: 5px 0;
            border: 2px solid ${user.name === currentDefaultSales ? '#4285f4' : '#ddd'};
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
            background: ${user.name === currentDefaultSales ? '#e3f2fd' : 'white'};
        `;
        
        userOption.innerHTML = `
            <div style="font-weight: 600; color: #333;">${user.online_status === 'online' ? '🟢 ' : '⚫ '}${user.name}</div>
            <div style="font-size: 11px; color: #666;">${user.email}</div>
            ${user.role === 'admin' ? '<div style="font-size: 10px; color: #f57c00; margin-top: 2px;">👑 Admin</div>' : ''}
        `;
        
        userOption.addEventListener('mouseover', () => {
            if (user.name !== currentDefaultSales) {
                userOption.style.borderColor = '#4285f4';
                userOption.style.background = '#f5f5f5';
            }
        });
        
        userOption.addEventListener('mouseout', () => {
            if (user.name !== currentDefaultSales) {
                userOption.style.borderColor = '#ddd';
                userOption.style.background = 'white';
            }
        });
        
        userOption.addEventListener('click', () => {
            overlay.remove();
            callback(user);
        });
        
        modal.appendChild(userOption);
    });
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
        width: 100%;
        margin-top: 15px;
        padding: 10px;
        border: none;
        border-radius: 6px;
        background: #ddd;
        color: #333;
        font-weight: 600;
        cursor: pointer;
    `;
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
        callback(null);
    });
    modal.appendChild(cancelBtn);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            callback(null);
        }
    });
}

// Update default sales
async function updateDefaultSales(phone, newDefaultSales, defaultSalesId, watiChatId) {
    try {
        const body = { 
            phoneNumber: phone,
            defaultSales: newDefaultSales,
            defaultSalesId: defaultSalesId
        };
        
        // Include watiChatId if available
        if (watiChatId) {
            body.watiChatId = watiChatId;
        }
        
        console.log('Updating default sales with body:', body);
        
        const response = await fetch(`${BACKEND_URL}/api/chats/default-sales`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        console.log('Response status:', response.status);
        
        let data;
        try {
            data = await response.json();
            console.log('Response data:', data);
        } catch (e) {
            console.error('Failed to parse response as JSON:', e);
            const text = await response.text();
            console.error('Response text:', text);
            alert(`Server error (${response.status}): ${text}`);
            return;
        }
        
        if (!response.ok) {
            console.error('Update failed:', data);
            // Handle error properly - it might be an object
            let errorMessage = 'Failed to update default sales';
            if (data.error) {
                if (typeof data.error === 'string') {
                    errorMessage = data.error;
                } else if (typeof data.error === 'object') {
                    errorMessage = JSON.stringify(data.error);
                }
            }
            alert(`${errorMessage} (Status: ${response.status})`);
            return;
        }
        
        console.log('✅ Default sales updated successfully');
        
        // Reload customer info
        loadCurrentCustomer();
    } catch (error) {
        console.error('Update default sales error:', error);
        alert('Network error: ' + error.message);
    }
}

function showLoginStatus(message, isError = false) {
    const statusDiv = document.getElementById('loginStatus');
    if (!statusDiv) return;
    
    statusDiv.textContent = message;
    statusDiv.className = `status-info ${isError ? 'warning' : ''}`;
    statusDiv.style.display = 'block';

    if (!isError) {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
}

function showStatus(message, isError = false) {
    const statusInfo = document.getElementById('statusInfo');
    if (!statusInfo) return;
    
    statusInfo.textContent = message;
    statusInfo.className = `status-info ${isError ? 'warning' : ''}`;
    statusInfo.style.display = 'block';

    setTimeout(() => {
        statusInfo.style.display = 'none';
    }, 3000);
}

// Control Panel Functions
function showControlPanel() {
    // Check if user is admin
    chrome.storage.sync.get(['userAuth'], (result) => {
        if (!result.userAuth || result.userAuth.role !== 'admin') {
            alert('Access denied. Admin only.');
            return;
        }
        
        document.getElementById('userSection').style.display = 'none';
        document.getElementById('controlPanelSection').style.display = 'block';
        
        // Load data
        loadAdminUserList();
        loadSystemStats();
    });
}

function hideControlPanel() {
    document.getElementById('controlPanelSection').style.display = 'none';
    document.getElementById('userSection').style.display = 'block';
}

async function loadAdminUserList() {
    const userListDiv = document.getElementById('userListAdmin');
    userListDiv.innerHTML = 'Loading...';
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/users/list`);
        if (!response.ok) {
            userListDiv.innerHTML = 'Failed to load users';
            return;
        }
        
        const data = await response.json();
        let users = data.users || [];
        
        if (users.length === 0) {
            userListDiv.innerHTML = '<div style="font-size: 12px; color: #999;">No users found</div>';
            return;
        }
        
        // Sort users: online first, then by ID
        users.sort((a, b) => {
            if (a.online_status === 'online' && b.online_status !== 'online') return -1;
            if (a.online_status !== 'online' && b.online_status === 'online') return 1;
            return a.id - b.id;
        });
        
        // Clear existing content
        userListDiv.innerHTML = '';
        
        // Create user role management cards
        users.forEach(user => {
            const userCard = document.createElement('div');
            userCard.style.cssText = `
                padding: 8px;
                margin: 5px 0;
                background: white;
                border-radius: 4px;
                border-left: 3px solid ${user.online_status === 'online' ? '#4caf50' : '#999'};
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;
            
            const userInfo = document.createElement('div');
            userInfo.innerHTML = `
                <div style="font-size: 12px; font-weight: 600; color: #333;">
                    ${user.online_status === 'online' ? '🟢' : '⚫'} ${user.name}
                    ${user.role === 'admin' ? ' 👑' : ''}
                </div>
                <div style="font-size: 10px; color: #666;">${user.email}</div>
            `;
            
            const roleSelect = document.createElement('select');
            roleSelect.style.cssText = `
                padding: 4px 8px;
                font-size: 11px;
                border: 1px solid #ddd;
                border-radius: 4px;
                background: white;
                cursor: pointer;
            `;
            roleSelect.innerHTML = `
                <option value="agent" ${user.role === 'agent' ? 'selected' : ''}>Agent</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            `;
            
            roleSelect.addEventListener('change', async () => {
                const newRole = roleSelect.value;
                if (confirm(`Change ${user.name}'s role to ${newRole}?`)) {
                    await updateUserRole(user.id, newRole);
                    loadAdminUserList(); // Reload the list
                } else {
                    roleSelect.value = user.role; // Revert selection
                }
            });
            
            userCard.appendChild(userInfo);
            userCard.appendChild(roleSelect);
            userListDiv.appendChild(userCard);
        });
    } catch (error) {
        console.error('Failed to load users:', error);
        userListDiv.innerHTML = 'Error loading users';
    }
}

async function updateUserRole(userId, newRole) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/users/role`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId, role: newRole })
        });
        
        if (!response.ok) {
            throw new Error('Failed to update role');
        }
    } catch (error) {
        console.error('Failed to update user role:', error);
        alert('Failed to update user role: ' + error.message);
    }
}

async function loadSystemStats() {
    try {
        // Load users stats
        const usersResponse = await fetch(`${BACKEND_URL}/api/users/list`);
        if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            const users = usersData.users || [];
            document.getElementById('statTotalUsers').textContent = users.length;
            document.getElementById('statOnlineUsers').textContent = users.filter(u => u.online_status === 'online').length;
        }
        
        // Load customer stats (you can add a backend endpoint for this)
        document.getElementById('statTotalCustomers').textContent = '-';
        document.getElementById('statMessagesToday').textContent = '-';
        
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

function viewAllCustomers() {
    alert('This will open a new page showing all customers from the database.\\n\\nFeature coming soon!');
}

function clearExtensionCache() {
    if (confirm('Are you sure you want to clear all extension cache? This will log you out.')) {
        chrome.storage.sync.clear(() => {
            alert('Cache cleared successfully!');
            location.reload();
        });
    }
}
