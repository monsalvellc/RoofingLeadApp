import { Button, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';

export default function SettingsScreen() {
  const { logout } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <View style={styles.body}>
        <Button title="Sign Out" onPress={logout} color="#c62828" />
      </View>
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
});
