import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { offlineStore } from '../storage/offlineStore';
import { FORM_MAX_WIDTH } from '../utils/layout';

const DEMO_PASSWORD = 'password123'; // DatabaseSeeder default, dev builds only

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    offlineStore.getServerUrl().then(setServerUrl);
  }, []);

  const handleLogin = async (loginEmail?: string, loginPass?: string) => {
    const finalEmail = loginEmail || email;
    const finalPass = loginPass || password;

    if (!finalEmail || !finalPass) {
      Alert.alert('Required', 'Please enter email and password');
      return;
    }

    setIsSubmitting(true);
    const result = await login(finalEmail, finalPass);
    setIsSubmitting(false);

    if (!result.success) {
      Alert.alert('Login Failed', result.message || 'Check your edge server connection');
    }
  };

  const handleSaveServerUrl = async () => {
    await offlineStore.setServerUrl(serverUrl);
    Alert.alert('Saved', 'Edge Server API URL updated');
    setShowConfig(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Brand Header */}
        <View style={styles.brandHeader}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>FC</Text>
          </View>
          <Text style={styles.title}>FoodCourt Multi-Stall</Text>
          <Text style={styles.subtitle}>Waiter & Kitchen Staff Terminal</Text>
        </View>

        {/* Credentials Form */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Staff Sign In</Text>

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. waiter1@foodcourt.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            onPress={() => handleLogin()}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Log In to Terminal</Text>
            )}
          </TouchableOpacity>

          {/* Seeded demo accounts: development builds only, never in a release APK */}
          {__DEV__ && (<>
          <Text style={styles.demoSectionTitle}>One-Tap Staff Logins (Demo)</Text>
          <View style={styles.demoGrid}>
            <TouchableOpacity
              style={styles.demoButton}
              onPress={() => {
                setEmail('waiter1@foodcourt.com');
                setPassword(DEMO_PASSWORD);
                handleLogin('waiter1@foodcourt.com', DEMO_PASSWORD);
              }}
            >
              <Text style={styles.demoButtonRole}>Waiter</Text>
              <Text style={styles.demoButtonName}>Ramesh (T1-T5)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.demoButton}
              onPress={() => {
                setEmail('waiter2@foodcourt.com');
                setPassword(DEMO_PASSWORD);
                handleLogin('waiter2@foodcourt.com', DEMO_PASSWORD);
              }}
            >
              <Text style={styles.demoButtonRole}>Waiter</Text>
              <Text style={styles.demoButtonName}>Suresh (T6-T10)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.demoButton, styles.demoButtonKitchen]}
              onPress={() => {
                setEmail('kitchen.pizza@foodcourt.com');
                setPassword(DEMO_PASSWORD);
                handleLogin('kitchen.pizza@foodcourt.com', DEMO_PASSWORD);
              }}
            >
              <Text style={styles.demoButtonRoleKitchen}>Kitchen KDS</Text>
              <Text style={styles.demoButtonName}>Pizza Stall</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.demoButton, styles.demoButtonKitchen]}
              onPress={() => {
                setEmail('kitchen.burger@foodcourt.com');
                setPassword(DEMO_PASSWORD);
                handleLogin('kitchen.burger@foodcourt.com', DEMO_PASSWORD);
              }}
            >
              <Text style={styles.demoButtonRoleKitchen}>Kitchen KDS</Text>
              <Text style={styles.demoButtonName}>Burger Stall</Text>
            </TouchableOpacity>
          </View>
          </>)}
        </View>

        {/* Server IP Config Toggle */}
        <TouchableOpacity
          style={styles.configToggle}
          onPress={() => setShowConfig(!showConfig)}
        >
          <Text style={styles.configToggleText}>
            ⚙️ {showConfig ? 'Hide' : 'Configure'} Edge Server IP / LAN
          </Text>
        </TouchableOpacity>

        {showConfig && (
          <View style={styles.configCard}>
            <Text style={styles.label}>Edge Server API URL:</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.1.50:8000/api"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.saveUrlButton} onPress={handleSaveServerUrl}>
              <Text style={styles.saveUrlButtonText}>Save Server URL</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 20,
    justifyContent: 'center',
    minHeight: '100%',
    // On a tablet the sign-in form stays a readable width, centred
    width: '100%',
    maxWidth: FORM_MAX_WIDTH,
    alignSelf: 'center',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#ea580c',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#ea580c',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  logoBadgeText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  button: {
    backgroundColor: '#ea580c',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  demoSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
  },
  demoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  demoButton: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  demoButtonKitchen: {
    borderColor: '#f59e0b',
  },
  demoButtonRole: {
    fontSize: 10,
    color: '#38bdf8',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  demoButtonRoleKitchen: {
    fontSize: 10,
    color: '#fbbf24',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  demoButtonName: {
    fontSize: 12,
    color: '#e2e8f0',
    fontWeight: '600',
    marginTop: 2,
  },
  configToggle: {
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 8,
  },
  configToggleText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  configCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  saveUrlButton: {
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveUrlButtonText: {
    color: '#f8fafc',
    fontWeight: '600',
    fontSize: 13,
  },
});

