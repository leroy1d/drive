import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, StyleSheet, Image, Platform, ScrollView } from "react-native";
import axios from "axios";
import * as DocumentPicker from "expo-document-picker";
import { MaterialIcons } from '@expo/vector-icons';

export default function Drive() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");

  const BASE_URL = "http://192.168.45.20:3002"; // IP du serveur si mobile réel

  useEffect(() => { loadFolders(); }, []);
  useEffect(() => { if (selectedFolder) loadFiles(selectedFolder.id); else setFiles([]); }, [selectedFolder]);

  const loadFolders = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/folders`);
      const validFolders = res.data.filter(f => f && f.id !== undefined);
      setFolders(validFolders);
      if (!selectedFolder && validFolders.length > 0) setSelectedFolder(validFolders[0]);
    } catch (err) { console.error(err); Alert.alert("Erreur", "Impossible de charger les dossiers"); }
  };

  const loadFiles = async (folderId) => {
    try {
      const res = await axios.get(`${BASE_URL}/files`);
      setFiles(res.data.filter(f => f && f.id !== undefined && f.folder_id === folderId));
    } catch (err) { console.error(err); }
  };

  const addFolder = async () => {
    if (!newFolderName.trim()) return;
    try { await axios.post(`${BASE_URL}/folders`, { name: newFolderName }); setNewFolderName(""); loadFolders(); }
    catch (err) { console.error(err); Alert.alert("Erreur", "Impossible de créer le dossier"); }
  };

  const deleteFolder = async (id) => {
    Alert.alert("Confirmer", "Voulez-vous supprimer ce dossier ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await axios.delete(`${BASE_URL}/folders/${id}`); if (selectedFolder?.id === id) setSelectedFolder(null); loadFolders(); } }
    ]);
  };

  const deleteFile = async (id) => {
    Alert.alert("Confirmer", "Voulez-vous supprimer ce fichier ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await axios.delete(`${BASE_URL}/files/${id}`); loadFiles(selectedFolder.id); } }
    ]);
  };

  // Upload Web
  const handleFileUploadWeb = async (event) => {
    if (!selectedFolder) { Alert.alert("Sélectionnez un dossier"); return; }
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder_id", selectedFolder.id);
    try { await axios.post(`${BASE_URL}/upload`, formData, { headers: { "Content-Type": "multipart/form-data" } }); loadFiles(selectedFolder.id); }
    catch (err) { console.error(err); Alert.alert("Erreur", "Impossible d’uploader le fichier"); }
  };

  // Upload Mobile
  const handleFileUploadMobile = async () => {
    if (!selectedFolder) { Alert.alert("Sélectionnez un dossier"); return; }
    const result = await DocumentPicker.getDocumentAsync({});
    if (result.type === "cancel") return;
    const { name, uri } = result;
    const fileType = name.split(".").pop();
    const formData = new FormData();
    formData.append("file", { uri, name, type: `application/${fileType}` });
    formData.append("folder_id", selectedFolder.id);
    try { await axios.post(`${BASE_URL}/upload`, formData, { headers: { "Content-Type": "multipart/form-data" } }); loadFiles(selectedFolder.id); }
    catch (err) { console.error(err); Alert.alert("Erreur", "Impossible d’uploader le fichier"); }
  };

  // Aperçu fichiers (image / PDF)
  const renderFilePreview = (file) => {
    if (!file.url) return <MaterialIcons name="insert-drive-file" size={40} color="#777" />;
    if (file.url.match(/\.(jpg|jpeg|png|gif)$/i)) return <Image source={{ uri: file.url }} style={{ width: 80, height: 80, borderRadius: 5 }} />;
    if (file.url.match(/\.(pdf)$/i)) return <MaterialIcons name="picture-as-pdf" size={40} color="#d93025" />;
    return <MaterialIcons name="insert-drive-file" size={40} color="#777" />;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Drive Public</Text>
        {Platform.OS !== "web" && (
          <TouchableOpacity style={styles.uploadBtn} onPress={handleFileUploadMobile}>
            <MaterialIcons name="upload-file" size={24} color="#fff" />
            <Text style={styles.uploadText}>Uploader</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Ajouter dossier */}
      <View style={styles.addFolder}>
        <TextInput placeholder="Nom dossier" value={newFolderName} onChangeText={setNewFolderName} style={styles.input} />
        <TouchableOpacity style={styles.addBtn} onPress={addFolder}>
          <MaterialIcons name="create-new-folder" size={24} color="#fff" />
          <Text style={styles.addText}>Ajouter</Text>
        </TouchableOpacity>
      </View>

      <ScrollView>
        {/* Dossiers */}
        <Text style={styles.sectionTitle}>Dossiers</Text>
        <FlatList
          data={folders}
          horizontal
          keyExtractor={item => item.id?.toString() || Math.random().toString()}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.folderCard, selectedFolder?.id === item.id && styles.folderSelected]} onPress={() => setSelectedFolder(item)}>
              <MaterialIcons name="folder" size={50} color="#f4b400" />
              <Text style={styles.folderName}>{item.name}</Text>
              <TouchableOpacity onPress={() => deleteFolder(item.id)} style={styles.deleteBtn}>
                <MaterialIcons name="delete" size={20} color="red" />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />

        {/* Fichiers */}
        <Text style={styles.sectionTitle}>Fichiers</Text>
        <FlatList
          data={files}
          numColumns={3}
          keyExtractor={item => item.id?.toString() || Math.random().toString()}
          renderItem={({ item }) => (
            <View style={styles.fileCard}>
              {renderFilePreview(item)}
              <Text numberOfLines={1} style={styles.fileName}>{item.name}</Text>
              <TouchableOpacity onPress={() => deleteFile(item.id)} style={styles.deleteBtn}>
                <MaterialIcons name="delete" size={20} color="red" />
              </TouchableOpacity>
            </View>
          )}
        />
      </ScrollView>

      {/* Upload Web */}
      {Platform.OS === "web" && selectedFolder && (
        <div style={{ marginVertical: 10 }}>
          <input type="file" onChange={handleFileUploadWeb} />
        </div>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa", // fond clair type Google Drive
    padding: 15,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 15,
    paddingHorizontal: 10,
    backgroundColor: "#4285f4", // bleu Drive
    borderRadius: 8,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0b5ed7",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 5,
  },
  uploadText: { color: "#fff", marginLeft: 5, fontWeight: "600" },

  addFolder: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 15,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#dadce0",
    borderRadius: 5,
    padding: 10,
    marginRight: 8,
    backgroundColor: "#fff",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#34a853", // vert Google
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 5,
  },
  addText: { color: "#fff", marginLeft: 5, fontWeight: "600" },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginVertical: 10,
    color: "#202124",
  },

  folderCard: {
    width: 120,
    height: 120,
    backgroundColor: "#fff",
    marginRight: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    position: "relative",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3, // Android shadow
  },
  folderSelected: { borderWidth: 2, borderColor: "#4285f4" },
  folderName: { marginTop: 6, textAlign: "center", fontWeight: "500", color: "#202124" },

  deleteBtn: { position: "absolute", top: 6, right: 6 },

  fileCard: {
    flex: 1,
    backgroundColor: "#fff",
    margin: 5,
    borderRadius: 10,
    alignItems: "center",
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  fileName: { marginTop: 5, textAlign: "center", fontSize: 14, color: "#202124", width: "90%" },
});
