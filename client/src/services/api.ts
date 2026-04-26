/**
 * Native Fetch wrapper to replace Axios.
 * Returns a structure compatible with axios (res.data) to avoid breaking existing code.
 */

const API_BASE_URL = '/api';

interface RequestOptions extends RequestInit {
  data?: any;
}

interface ApiResponse<T> {
  data: T;
  status: number;
  ok: boolean;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T = any>(endpoint: string, { data, ...customConfig }: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers = { 'Content-Type': 'application/json', ...customConfig.headers } as any;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const config: RequestInit = {
    ...customConfig,
    headers,
    credentials: 'include', // SECURITY FIX: Include cookies in all requests for JWT auth
    signal: controller.signal,
  };

  if (data) {
    config.body = JSON.stringify(data);
  }

  let response: globalThis.Response;
  try {
    response = await fetch(endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`, config);
  } finally {
    clearTimeout(timeoutId);
  }
  
  if (response.status === 401 || response.status === 403) {
    // SECURITY: Only trigger global logout for session check, not for specific credential errors
    if (!endpoint.includes('/auth/login') && !endpoint.includes('/auth/change-password')) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
  }

  let result: any;
  try {
    result = await response.json();
  } catch (e) {
    result = null;
  }

  if (response.ok) {
    return {
      data: result as T,
      status: response.status,
      ok: response.ok
    };
  }

  const errorMessage = Array.isArray(result?.message) 
    ? result.message.join(', ') 
    : (result?.message || 'API Request failed');

  throw new Error(errorMessage);
}

export default {
  get: <T = any>(endpoint: string, config?: RequestOptions) => request<T>(endpoint, { ...config, method: 'GET' }),
  post: <T = any>(endpoint: string, data?: any, config?: RequestOptions) => request<T>(endpoint, { ...config, method: 'POST', data }),
  patch: <T = any>(endpoint: string, data?: any, config?: RequestOptions) => request<T>(endpoint, { ...config, method: 'PATCH', data }),
  delete: <T = any>(endpoint: string, config?: RequestOptions) => request<T>(endpoint, { ...config, method: 'DELETE' }),
};
