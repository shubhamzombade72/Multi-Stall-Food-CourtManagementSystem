import axios from 'axios';

// Customers' phones reach the edge server by its LAN address, never "localhost".
// Set VITE_API_BASE_URL at build time, or serve this app and the API from the same origin.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

