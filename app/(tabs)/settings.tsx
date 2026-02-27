import { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebaseConfig';
import { useAuth } from '../../context/AuthContext';

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        setUserProfile({ id: snap.id, ...snap.data() });
      }
    });
    return unsubscribe;
  }, [user?.uid]);

  const handleToggleHd = async (newValue: boolean) => {
    if (!auth.currentUser?.uid) return;
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      hdPhotosEnabled: newValue,
    });
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.replace('/login');
  };

  const fullName =
    [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(' ') || '—';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>

        {/* ── Profile Card ── */}
        <Text style={styles.sectionLabel}>Profile</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text style={styles.rowValue}>{fullName}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {userProfile?.email ?? auth.currentUser?.email ?? '—'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Role</Text>
            <Text style={styles.rowValue}>{userProfile?.role ?? '—'}</Text>
          </View>
        </View>

        {/* ── Media Settings (feature-flag gated) ── */}
        {userProfile?.allowHdToggle === true && (
          <>
            <Text style={styles.sectionLabel}>Media Settings</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.hdLabel}>Enable HD Photo Uploads</Text>
                <Switch
                  value={userProfile?.hdPhotosEnabled === true}
                  onValueChange={handleToggleHd}
                  trackColor={{ false: '#e0e0e0', true: '#a5d6a7' }}
                  thumbColor={userProfile?.hdPhotosEnabled ? '#2e7d32' : '#bdbdbd'}
                />
              </View>
            </View>
          </>
        )}

        {/* ── Sign Out ── */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2e7d32',
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
  },
  body: {
    padding: 20,
    paddingBottom: 48,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 20,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
    width: 70,
  },
  rowValue: {
    fontSize: 15,
    color: '#1a1a1a',
    flex: 1,
    textAlign: 'right',
  },
  hdLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
  },
  signOutBtn: {
    marginTop: 36,
    backgroundColor: '#c62828',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#c62828',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
});
