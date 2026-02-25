import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../config/firebaseConfig';
import * as Location from 'expo-location';
import { JobFile, LeadFile } from '../types';
import { useAuth } from '../context/AuthContext';
import LeadImagePicker from '../components/LeadImagePicker';

const STATUS_OPTIONS = [
  'Lead',
  'Retail',
  'Inspected',
  'Claim Filed',
  'Met with Adjuster',
  'Partial Approval',
  'Full Approval',
  'Production',
  'Pending Payment',
  'Delinquent Payment',
  'Completed',
] as const;

const JOB_TYPE_OPTIONS = ['Retail', 'Insurance'] as const;

const TRADE_OPTIONS = [
  'Roof',
  'Gutters',
  'Fascia',
  'Windows',
  'Window Wraps',
  'Window Screens',
  'Skylights',
  'Siding',
  'Framing',
  'Demolition',
  'Other',
] as const;

// Format raw digits into (###) ###-####
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function AddLeadScreen() {
  const router = useRouter();
  const { user, userProfile } = useAuth();

  const [isSaving, setIsSaving] = useState(false);

  // Customer search / existing customer selection
  const [existingCustomers, setExistingCustomers] = useState<any[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<any[]>([]);
  const [selectedExistingCustomer, setSelectedExistingCustomer] = useState<any | null>(null);

  // Customer
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [alternateAddress, setAlternateAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Job
  const [jobId] = useState(() => `JOB-${Date.now()}`);
  const [jobName, setJobName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [measurements, setMeasurements] = useState('');
  const [jobType, setJobType] = useState<'Retail' | 'Insurance'>('Insurance');
  const [status, setStatus] = useState<string>('Lead');
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [trades, setTrades] = useState<string[]>(['Roof']);
  const [customTrade, setCustomTrade] = useState('');
  const [jobNotes, setJobNotes] = useState('');

  // Financials
  const [contractAmount, setContractAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositPaid, setDepositPaid] = useState(false);
  const [payments, setPayments] = useState<number[]>([]);
  const [newPayment, setNewPayment] = useState('');

  // Files
  const [files, setFiles] = useState<LeadFile[]>([]);
  const [folderPermissions, setFolderPermissions] = useState<Record<string, boolean>>({});

  // Insurance
  const [carrier, setCarrier] = useState('');
  const [claimNumber, setClaimNumber] = useState('');
  const [deductible, setDeductible] = useState('');
  const [adjusterName, setAdjusterName] = useState('');
  const [adjusterPhone, setAdjusterPhone] = useState('');
  const [adjusterEmail, setAdjusterEmail] = useState('');
  const [dateOfLoss, setDateOfLoss] = useState('');
  const [dateOfDiscovery, setDateOfDiscovery] = useState('');

  // Validation
  const isFormValid =
    name.trim().length > 0 &&
    address.trim().length > 0;

  // Phone formatting
  const handlePhoneChange = (text: string) => {
    setPhone(formatPhone(text));
  };

  // Dollar formatting on blur
  const formatDollarOnBlur = (value: string, setter: (v: string) => void) => {
    if (!value) return;
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (cleaned) setter('$' + cleaned);
  };

  // Trade multi-select toggle
  const toggleTrade = (t: string) => {
    setTrades((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  // Financials
  const parsedContract = parseFloat(contractAmount.replace(/[^0-9.]/g, '')) || 0;
  const parsedDeposit = parseFloat(depositAmount.replace(/[^0-9.]/g, '')) || 0;
  const paymentsTotal = payments.reduce((sum, p) => sum + p, 0);
  const balance = parsedContract - (depositPaid ? parsedDeposit : 0) - paymentsTotal;

  const addPayment = () => {
    const amount = parseFloat(newPayment.replace(/[^0-9.]/g, ''));
    if (!amount || amount <= 0) return;
    setPayments((prev) => [...prev, amount]);
    setNewPayment('');
  };

  // Fetch all customers for this company
  useEffect(() => {
    if (!userProfile?.companyId) return;
    const q = query(
      collection(db, 'customers'),
      where('companyId', '==', userProfile.companyId),
    );
    const unsub = onSnapshot(q, (snap) => {
      setExistingCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userProfile?.companyId]);

  // Filter customers as the name input changes
  useEffect(() => {
    if (!name.trim() || selectedExistingCustomer) {
      setFilteredCustomers([]);
      return;
    }
    const lower = name.toLowerCase();
    setFilteredCustomers(
      existingCustomers.filter((c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(lower),
      ),
    );
  }, [name, existingCustomers, selectedExistingCustomer]);

  const handleSelectCustomer = (customer: any) => {
    setSelectedExistingCustomer(customer);
    setFilteredCustomers([]);
    setName(`${customer.firstName} ${customer.lastName}`.trim());
    setPhone(customer.phone || '');
    setAddress(customer.address || '');
    setEmail(customer.email || '');
    setLeadSource(customer.leadSource || '');
    setAlternateAddress(customer.alternateAddress || '');
    setNotes(customer.notes || '');
  };

  const handleClearCustomerSelection = () => {
    setSelectedExistingCustomer(null);
    setName('');
    setPhone('');
    setAddress('');
    setEmail('');
    setLeadSource('');
    setAlternateAddress('');
    setNotes('');
  };

  const handleSave = async () => {
    if (isSaving) { console.log('Already saving, blocking double fire.'); return; }
    setIsSaving(true);

    // Step A: Split name into firstName / lastName
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Build final trades array, replacing 'Other' with custom text
    const finalTrades = trades
      .map((t) => (t === 'Other' && customTrade.trim() ? customTrade.trim() : t))
      .filter((t) => t !== 'Other' || customTrade.trim());

    const parsedDeductible = parseFloat(deductible.replace(/[^0-9.]/g, '')) || 0;
    const now = Date.now();

    // Convert LeadFile[] (from LeadImagePicker) → JobFile[] (structured storage format)
    const categoryToType = (cat: string): JobFile['type'] => {
      if (cat === 'Install') return 'install';
      if (cat === 'Documents') return 'document';
      return 'inspection';
    };
    const jobFiles: JobFile[] = files.map((f) => ({
      id: f.id,
      url: f.url,
      type: categoryToType(f.category),
      isSharedWithCustomer: f.isPublic,
      createdAt: new Date(f.createdAt).toISOString(),
    }));

    // Geocode the address silently — never blocks save on failure
    let locationCoords: { lat: number; lng: number } | null = null;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const geocoded = await Location.geocodeAsync(address);
        if (geocoded && geocoded.length > 0) {
          locationCoords = { lat: geocoded[0].latitude, lng: geocoded[0].longitude };
        } else {
          console.log('Geocode returned empty array for address:', address);
        }
      } else {
        console.log('Location permission denied by user.');
      }
    } catch (error) {
      console.log('Geocoding Error:', error);
    }

    // Step B & C: Create Firestore references with auto-generated IDs
    const customerRef = selectedExistingCustomer ? null : doc(collection(db, 'customers'));
    const jobRef = doc(collection(db, 'jobs'));
    const customerId = selectedExistingCustomer ? selectedExistingCustomer.id : customerRef!.id;

    // Step D: Construct Customer object (only when creating a new customer)
    const companyId = userProfile?.companyId || 'UNKNOWN_COMPANY';

    const newCustomer = selectedExistingCustomer ? null : {
      id: customerRef!.id,
      companyId,
      firstName,
      lastName,
      phone: phone || '',
      email: email || '',
      address,
      alternateAddress: alternateAddress || '',
      leadSource: leadSource || '',
      notes: notes || '',
      location: locationCoords,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    };

    // Step E: Construct Job object
    const newJob = {
      id: jobRef.id,
      customerId,
      companyId,
      jobId,
      assignedUserIds: user?.uid ? [user.uid] : [],
      status,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone: phone || '',
      customerAddress: address || '',
      customerAlternateAddress: alternateAddress || '',
      jobName: jobName || '',
      jobDescription: jobDescription || '',
      measurements: measurements || '',
      jobType,
      jobNotes: jobNotes || '',
      trades: finalTrades,
      contractAmount: parsedContract,
      depositAmount: parsedDeposit,
      isDepositPaid: depositPaid,
      payments,
      balance,
      carrier: carrier || '',
      claimNumber: claimNumber || '',
      deductible: parsedDeductible,
      adjusterName: adjusterName || '',
      adjusterPhone: adjusterPhone || '',
      adjusterEmail: adjusterEmail || '',
      dateOfLoss: dateOfLoss || '',
      dateOfDiscovery: dateOfDiscovery || '',
      mainMaterialCost: 0,
      additionalSpent: [],
      returnedMaterialCredit: 0,
      installersCost: 0,
      guttersCost: 0,
      files: jobFiles,
      folderPermissions,
    };

    console.log('--- STARTING SAVE PROCESS ---');
    console.log('1. DB Connection:', db ? 'Valid' : 'Missing');
    console.log('2. Customer ID:', customerId, selectedExistingCustomer ? '(existing)' : '(new)');
    console.log('3. Job ID:', jobRef.id);

    try {
      // Step F: Write documents — skip customer write if linking to existing
      if (newCustomer && customerRef) {
        await setDoc(customerRef, newCustomer);
      }
      await setDoc(jobRef, newJob);
      console.log('4. WRITE SUCCESS!');

      // Step G: Navigate back safely
      Alert.alert('Success', 'Customer & Job Saved', [
        {
          text: 'OK',
          onPress: () => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          },
        },
      ]);
    } catch (e: any) {
      console.error('WRITE FAILED:', e);
      console.error('Error Code:', e.code);
      console.error('Error Message:', e.message);
      Alert.alert('SAVE FAILED', e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New Lead' }} />

      {/* ── Status Picker Modal ── */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStatusModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setStatusModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Status</Text>
            {STATUS_OPTIONS.map((opt) => (
              <Pressable
                key={opt}
                style={[
                  styles.modalOption,
                  status === opt && styles.modalOptionActive,
                ]}
                onPress={() => {
                  setStatus(opt);
                  setStatusModalVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    status === opt && styles.modalOptionTextActive,
                  ]}
                >
                  {opt}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Customer Info ── */}
          <Text style={styles.sectionTitle}>Customer Info</Text>
          <View style={styles.section}>
            <View>
              <TextInput
                style={[styles.input, !name.trim() && styles.inputRequired]}
                placeholder="Name *"
                placeholderTextColor="#999"
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  if (selectedExistingCustomer) setSelectedExistingCustomer(null);
                }}
              />
              {filteredCustomers.length > 0 && (
                <View style={styles.customerDropdown}>
                  {filteredCustomers.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.customerDropdownItem}
                      onPress={() => handleSelectCustomer(c)}
                    >
                      <Text style={styles.customerDropdownName}>
                        {c.firstName} {c.lastName}
                      </Text>
                      <Text style={styles.customerDropdownAddress}>{c.address}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {selectedExistingCustomer && (
                <View style={styles.selectedCustomerBadge}>
                  <Text style={styles.selectedCustomerText}>
                    ✓ Existing customer linked — no duplicate will be created
                  </Text>
                  <Pressable onPress={handleClearCustomerSelection}>
                    <Text style={styles.clearBtnText}>Clear</Text>
                  </Pressable>
                </View>
              )}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Phone (###) ###-####"
              placeholderTextColor="#999"
              keyboardType="phone-pad"
              maxLength={14}
              value={phone}
              onChangeText={handlePhoneChange}
            />
            <TextInput
              style={[styles.input, !address.trim() && styles.inputRequired]}
              placeholder="Address *"
              placeholderTextColor="#999"
              value={address}
              onChangeText={setAddress}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Lead Source"
              placeholderTextColor="#999"
              value={leadSource}
              onChangeText={setLeadSource}
            />
            <TextInput
              style={styles.input}
              placeholder="Alternate Address"
              placeholderTextColor="#999"
              value={alternateAddress}
              onChangeText={setAlternateAddress}
            />
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Notes"
              placeholderTextColor="#999"
              multiline
              textAlignVertical="top"
              value={notes}
              onChangeText={setNotes}
            />
          </View>

          {/* ── Job Details ── */}
          <Text style={styles.sectionTitle}>Job Details</Text>
          <View style={styles.section}>
            {/* Job ID (read-only) */}
            <Text style={styles.fieldLabel}>Job ID</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{jobId}</Text>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Job Name"
              placeholderTextColor="#999"
              value={jobName}
              onChangeText={setJobName}
            />
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Job Description"
              placeholderTextColor="#999"
              multiline
              textAlignVertical="top"
              value={jobDescription}
              onChangeText={setJobDescription}
            />
            <TextInput
              style={styles.input}
              placeholder="Measurements"
              placeholderTextColor="#999"
              value={measurements}
              onChangeText={setMeasurements}
            />

            {/* Job Type segmented control */}
            <Text style={styles.fieldLabel}>Job Type</Text>
            <View style={styles.segmentedRow}>
              {JOB_TYPE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  style={[
                    styles.segmentButton,
                    jobType === opt && styles.segmentButtonActive,
                  ]}
                  onPress={() => setJobType(opt)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      jobType === opt && styles.segmentTextActive,
                    ]}
                  >
                    {opt}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Status dropdown trigger */}
            <Text style={styles.fieldLabel}>Status</Text>
            <Pressable
              style={styles.dropdown}
              onPress={() => setStatusModalVisible(true)}
            >
              <Text style={styles.dropdownText}>{status}</Text>
              <Text style={styles.dropdownArrow}>▼</Text>
            </Pressable>

            {/* Trades multi-select chips */}
            <Text style={styles.fieldLabel}>Trades</Text>
            <View style={styles.chipRow}>
              {TRADE_OPTIONS.map((opt) => {
                const selected = trades.includes(opt);
                return (
                  <Pressable
                    key={opt}
                    style={[styles.chip, selected && styles.chipActive]}
                    onPress={() => toggleTrade(opt)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextActive,
                      ]}
                    >
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {trades.includes('Other') && (
              <TextInput
                style={styles.input}
                placeholder="Describe custom trade"
                placeholderTextColor="#999"
                value={customTrade}
                onChangeText={setCustomTrade}
              />
            )}

            {/* Job Notes */}
            <Text style={styles.fieldLabel}>Job Notes</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Specific details about the job (e.g. 'Use 6-inch gutters')"
              placeholderTextColor="#999"
              multiline
              textAlignVertical="top"
              value={jobNotes}
              onChangeText={setJobNotes}
            />
          </View>

          {/* ── Financials ── */}
          <Text style={styles.sectionTitle}>Financials</Text>
          <View style={styles.section}>
            <TextInput
              style={styles.input}
              placeholder="Contract Amount ($)"
              placeholderTextColor="#999"
              keyboardType="numeric"
              value={contractAmount}
              onChangeText={setContractAmount}
              onBlur={() => formatDollarOnBlur(contractAmount, setContractAmount)}
            />

            <View style={styles.depositRow}>
              <TextInput
                style={[styles.input, styles.depositInput]}
                placeholder="Deposit Amount ($)"
                placeholderTextColor="#999"
                keyboardType="numeric"
                value={depositAmount}
                onChangeText={setDepositAmount}
                onBlur={() => formatDollarOnBlur(depositAmount, setDepositAmount)}
              />
              <View style={styles.depositToggle}>
                <Text style={styles.depositLabel}>Deposit Paid?</Text>
                <Switch
                  value={depositPaid}
                  onValueChange={setDepositPaid}
                  trackColor={{ false: '#ccc', true: '#81c784' }}
                  thumbColor={depositPaid ? '#2e7d32' : '#f4f3f4'}
                />
              </View>
            </View>

            {/* Add Payment */}
            <Text style={styles.fieldLabel}>Payments</Text>
            <View style={styles.addPaymentRow}>
              <TextInput
                style={[styles.input, styles.paymentInput]}
                placeholder="Amount ($)"
                placeholderTextColor="#999"
                keyboardType="numeric"
                value={newPayment}
                onChangeText={setNewPayment}
              />
              <Pressable style={styles.addPaymentButton} onPress={addPayment}>
                <Text style={styles.addPaymentText}>+ Add</Text>
              </Pressable>
            </View>

            {payments.length > 0 && (
              <View style={styles.paymentsList}>
                {payments.map((p, i) => (
                  <View key={i} style={styles.paymentItem}>
                    <Text style={styles.paymentItemText}>
                      Payment {i + 1}: ${p.toFixed(2)}
                    </Text>
                    <Pressable onPress={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))}>
                      <Text style={styles.paymentRemove}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* Balance */}
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Balance</Text>
              <Text style={[styles.balanceValue, balance < 0 && styles.balanceNegative]}>
                ${balance.toFixed(2)}
              </Text>
            </View>
          </View>

          {/* ── Insurance Details (conditional) ── */}
          {jobType === 'Insurance' && (
            <>
              <Text style={styles.sectionTitle}>Insurance Details</Text>
              <View style={styles.section}>
                <TextInput
                  style={styles.input}
                  placeholder="Carrier"
                  placeholderTextColor="#999"
                  value={carrier}
                  onChangeText={setCarrier}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Claim Number"
                  placeholderTextColor="#999"
                  value={claimNumber}
                  onChangeText={setClaimNumber}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Deductible ($)"
                  placeholderTextColor="#999"
                  keyboardType="numeric"
                  value={deductible}
                  onChangeText={setDeductible}
                  onBlur={() => formatDollarOnBlur(deductible, setDeductible)}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Adjuster Name"
                  placeholderTextColor="#999"
                  value={adjusterName}
                  onChangeText={setAdjusterName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Adjuster Phone"
                  placeholderTextColor="#999"
                  keyboardType="phone-pad"
                  value={adjusterPhone}
                  onChangeText={setAdjusterPhone}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Adjuster Email"
                  placeholderTextColor="#999"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={adjusterEmail}
                  onChangeText={setAdjusterEmail}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Date of Loss (MM/DD/YYYY)"
                  placeholderTextColor="#999"
                  value={dateOfLoss}
                  onChangeText={setDateOfLoss}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Date of Discovery (MM/DD/YYYY)"
                  placeholderTextColor="#999"
                  value={dateOfDiscovery}
                  onChangeText={setDateOfDiscovery}
                />
              </View>
            </>
          )}

          {/* ── Files ── */}
          <Text style={styles.sectionTitle}>Files</Text>
          <LeadImagePicker
            onUpdate={(updatedFiles, updatedPerms) => {
              setFiles(updatedFiles);
              setFolderPermissions(updatedPerms);
            }}
          />

          {/* ── Save ── */}
          <Pressable
            style={[styles.saveButton, (!isFormValid || isSaving) && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={!isFormValid || isSaving}
          >
            <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'SAVE LEAD'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },

  // Sections
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginTop: 20,
    marginBottom: 8,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },

  // Inputs
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: '#1a1a1a',
    backgroundColor: '#fafafa',
  },
  inputRequired: {
    borderColor: '#ffcdd2',
  },
  notesInput: {
    minHeight: 100,
  },
  multilineInput: {
    minHeight: 80,
  },

  // Read-only field
  readOnlyField: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 14,
    backgroundColor: '#f0f0f0',
  },
  readOnlyText: {
    fontSize: 15,
    color: '#666',
    fontWeight: '600',
  },

  // Financials
  depositRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  depositInput: {
    flex: 1,
  },
  depositToggle: {
    alignItems: 'center',
    gap: 4,
  },
  depositLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  addPaymentRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  paymentInput: {
    flex: 1,
  },
  addPaymentButton: {
    backgroundColor: '#2e7d32',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  addPaymentText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  paymentsList: {
    gap: 6,
  },
  paymentItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
  },
  paymentItemText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  paymentRemove: {
    fontSize: 13,
    fontWeight: '600',
    color: '#c62828',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  balanceLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2e7d32',
  },
  balanceNegative: {
    color: '#c62828',
  },

  // Field label
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
  },

  // Segmented control (job type)
  segmentedRow: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#ddd',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  segmentButtonActive: {
    backgroundColor: '#2e7d32',
  },
  segmentText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#777',
  },
  segmentTextActive: {
    color: '#fff',
  },

  // Dropdown (status picker trigger)
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    backgroundColor: '#fafafa',
  },
  dropdownText: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#999',
  },

  // Status modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    gap: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  modalOptionActive: {
    backgroundColor: '#e8f5e9',
  },
  modalOptionText: {
    fontSize: 16,
    color: '#333',
  },
  modalOptionTextActive: {
    color: '#2e7d32',
    fontWeight: '700',
  },

  // Trade chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  chipActive: {
    borderColor: '#2e7d32',
    backgroundColor: '#e8f5e9',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#777',
  },
  chipTextActive: {
    color: '#2e7d32',
  },

  // Customer search autocomplete
  customerDropdown: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  customerDropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  customerDropdownName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  customerDropdownAddress: {
    fontSize: 13,
    color: '#777',
    marginTop: 2,
  },
  selectedCustomerBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#c8e6c9',
    marginTop: 6,
  },
  selectedCustomerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2e7d32',
    flex: 1,
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#c62828',
    marginLeft: 10,
  },

  // Save button
  saveButton: {
    marginTop: 28,
    backgroundColor: '#2e7d32',
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
});
