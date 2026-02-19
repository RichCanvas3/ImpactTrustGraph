"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConnection } from "../../components/connection-context";
import {
  Container,
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Grid,
  Divider,
  CircularProgress,
  Alert,
  Snackbar
} from "@mui/material";
import { getUserProfile, saveUserProfile } from "../../app/service/userProfileService";
import type { UserProfile } from "../../app/service/userProfileService";

export default function ProfilePage() {
  const router = useRouter();
  const { user } = useConnection();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [editData, setEditData] = React.useState({ first_name: "", last_name: "" });
  const [snackbar, setSnackbar] = React.useState({ open: false, message: "", severity: "success" as "success" | "error" });

  React.useEffect(() => {
    async function loadProfile() {
      if (!user?.email) {
        setError("Please connect your wallet to view your profile.");
        setLoading(false);
        return;
      }

      try {
        const userProfile = await getUserProfile(user.email);
        if (userProfile) {
          setProfile(userProfile);
          setEditData({
            first_name: userProfile.first_name || "",
            last_name: userProfile.last_name || "",
          });
        } else {
          setError("Profile not found. Please complete onboarding first.");
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
        setError("Failed to load profile information.");
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, [user?.email]);

  const handleSave = async () => {
    if (!user?.email) return;

    setSaving(true);
    try {
      const updated = await saveUserProfile({
        email: user.email,
        first_name: editData.first_name || null,
        last_name: editData.last_name || null,
        eoa_address: profile?.eoa_address,
        aa_address: profile?.aa_address,
        social_account_id: profile?.social_account_id,
        social_account_type: profile?.social_account_type,
      });
      setProfile(updated);
      setSnackbar({ open: true, message: "Profile updated successfully", severity: "success" });
    } catch (err) {
      console.error("Failed to save profile:", err);
      setSnackbar({ open: true, message: "Failed to update profile", severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="400px" gap={2}>
          <CircularProgress />
          <Typography variant="body1" color="text.secondary">
            Loading profile...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button variant="contained" onClick={() => router.push("/")}>
          Go to Home
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box mb={4}>
        <Typography variant="h4" component="h1" gutterBottom fontWeight={600}>
          My Profile
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your personal information
        </Typography>
      </Box>

      <Card elevation={2}>
        <CardContent>
          <Typography variant="h6" gutterBottom fontWeight={600}>
            Personal Information
          </Typography>
          <Divider sx={{ my: 2 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={editData.first_name}
                onChange={(e) => setEditData({ ...editData, first_name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={editData.last_name}
                onChange={(e) => setEditData({ ...editData, last_name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Email"
                value={profile?.email || ""}
                disabled
                helperText="Email cannot be changed"
              />
            </Grid>
            {profile?.eoa_address && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="EOA Address"
                  value={profile.eoa_address}
                  disabled
                  helperText="Wallet address (read-only)"
                />
              </Grid>
            )}
            {profile?.aa_address && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="AA Address"
                  value={profile.aa_address}
                  disabled
                  helperText="Account Abstraction address (read-only)"
                />
              </Grid>
            )}
          </Grid>

          <Box sx={{ mt: 4, display: "flex", gap: 2, justifyContent: "flex-end" }}>
            <Button variant="outlined" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Container>
  );
}

