using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.ComponentModel;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AerolabInstaller
{
    public class InstallerForm : Form
    {
        private ProgressBar progressBar;
        private Label statusLabel;
        private Button launchButton;
        private string installDir;

        public InstallerForm()
        {
            Text = "AEROLAB Setup";
            Width = 480;
            Height = 260;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Color.FromArgb(15, 23, 42); // #0f172a
            ForeColor = Color.White;

            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string icoPath = Path.Combine(baseDir, "aerolab.ico");
                if (File.Exists(icoPath))
                {
                    Icon = new Icon(icoPath);
                }
            }
            catch {}

            Label titleLabel = new Label
            {
                Text = "AEROLAB Setup",
                Font = new Font("Segoe UI", 16, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(24, 20),
                AutoSize = true
            };
            Controls.Add(titleLabel);

            Label descLabel = new Label
            {
                Text = "Installing AEROLAB Physiological Running Analytics...",
                Font = new Font("Segoe UI", 10),
                ForeColor = Color.FromArgb(148, 163, 184), // #94a3b8
                Location = new Point(26, 56),
                AutoSize = true
            };
            Controls.Add(descLabel);

            progressBar = new ProgressBar
            {
                Location = new Point(26, 95),
                Width = 412,
                Height = 24,
                Style = ProgressBarStyle.Marquee
            };
            Controls.Add(progressBar);

            statusLabel = new Label
            {
                Text = "Preparing installation...",
                Font = new Font("Segoe UI", 9),
                ForeColor = Color.FromArgb(203, 213, 225),
                Location = new Point(26, 130),
                AutoSize = true
            };
            Controls.Add(statusLabel);

            launchButton = new Button
            {
                Text = "Launch AEROLAB",
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                BackColor = Color.FromArgb(59, 130, 246),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(280, 165),
                Width = 158,
                Height = 36,
                Visible = false
            };
            launchButton.FlatAppearance.BorderSize = 0;
            launchButton.Click += (s, e) =>
            {
                string exePath = Path.Combine(installDir, "AEROLAB.exe");
                if (File.Exists(exePath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        WorkingDirectory = installDir
                    });
                }
                Close();
            };
            Controls.Add(launchButton);

            Shown += (s, e) => StartInstall();
        }

        private void StartInstall()
        {
            BackgroundWorker worker = new BackgroundWorker();
            worker.DoWork += (s, args) =>
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                installDir = Path.Combine(localAppData, "Programs", "AEROLAB");

                SetStatus("Creating application directory...");
                if (!Directory.Exists(installDir))
                {
                    Directory.CreateDirectory(installDir);
                }

                SetStatus("Extracting application files...");
                Stream zipStream = null;
                Assembly assembly = Assembly.GetExecutingAssembly();

                foreach (string name in assembly.GetManifestResourceNames())
                {
                    if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        zipStream = assembly.GetManifestResourceStream(name);
                        break;
                    }
                }

                if (zipStream != null)
                {
                    using (ZipArchive archive = new ZipArchive(zipStream))
                    {
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string destPath = Path.Combine(installDir, entry.FullName);
                            if (string.IsNullOrEmpty(entry.Name))
                            {
                                Directory.CreateDirectory(destPath);
                            }
                            else
                            {
                                Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                                entry.ExtractToFile(destPath, true);
                            }
                        }
                    }
                }
                else
                {
                    // Fallback to local zip file if not embedded
                    string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                    string localZip = Path.Combine(baseDir, "AEROLAB-Windows.zip");
                    if (File.Exists(localZip))
                    {
                        ZipFile.ExtractToDirectory(localZip, installDir);
                    }
                    else
                    {
                        throw new FileNotFoundException("Application payload zip was not found.");
                    }
                }

                SetStatus("Creating Start Menu and Desktop shortcuts...");
                string exePath = Path.Combine(installDir, "AEROLAB.exe");
                string icoPath = Path.Combine(installDir, "aerolab.ico");

                // Desktop shortcut
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                CreateShortcut(Path.Combine(desktop, "AEROLAB.lnk"), exePath, icoPath);

                // Start Menu shortcut
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                CreateShortcut(Path.Combine(startMenu, "AEROLAB.lnk"), exePath, icoPath);

                SetStatus("Registering in Windows Programs...");
                RegisterUninstall(installDir, icoPath);
            };

            worker.RunWorkerCompleted += (s, args) =>
            {
                if (args.Error != null)
                {
                    progressBar.Visible = false;
                    statusLabel.Text = "Installation failed: " + args.Error.Message;
                    statusLabel.ForeColor = Color.Red;
                    MessageBox.Show("Installation Error:\n\n" + args.Error.Message, "AEROLAB Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                else
                {
                    progressBar.Style = ProgressBarStyle.Blocks;
                    progressBar.Value = 100;
                    statusLabel.Text = "Installation completed successfully!";
                    statusLabel.ForeColor = Color.FromArgb(74, 222, 128); // #4ade80
                    launchButton.Visible = true;
                }
            };

            worker.RunWorkerAsync();
        }

        private void SetStatus(string text)
        {
            if (InvokeRequired)
            {
                Invoke(new Action(() => SetStatus(text)));
                return;
            }
            statusLabel.Text = text;
        }

        private void CreateShortcut(string lnkPath, string targetPath, string iconPath)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null)
                {
                    dynamic shell = Activator.CreateInstance(shellType);
                    dynamic shortcut = shell.CreateShortcut(lnkPath);
                    shortcut.TargetPath = targetPath;
                    shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                    if (File.Exists(iconPath))
                    {
                        shortcut.IconLocation = iconPath;
                    }
                    shortcut.Description = "AEROLAB - Physiological Running Analytics";
                    shortcut.Save();
                }
            }
            catch {}
        }

        private void RegisterUninstall(string path, string iconPath)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\AEROLAB"))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "AEROLAB");
                        key.SetValue("DisplayVersion", "1.0.0");
                        key.SetValue("Publisher", "AEROLAB");
                        key.SetValue("InstallLocation", path);
                        key.SetValue("DisplayIcon", iconPath);
                        key.SetValue("UninstallString", "\"" + Path.Combine(path, "Uninstall.bat") + "\"");
                    }
                }

                // Write a simple uninstaller bat file
                string uninstallerBat = Path.Combine(path, "Uninstall.bat");
                string batContent = "@echo off\r\n" +
                    "taskkill /f /im node.exe >nul 2>&1\r\n" +
                    "del /q \"%USERPROFILE%\\Desktop\\AEROLAB.lnk\" >nul 2>&1\r\n" +
                    "del /q \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\AEROLAB.lnk\" >nul 2>&1\r\n" +
                    "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AEROLAB\" /f >nul 2>&1\r\n" +
                    "echo AEROLAB uninstalled successfully.\r\n" +
                    "rmdir /s /q \"" + path + "\"\r\n";
                File.WriteAllText(uninstallerBat, batContent);
            }
            catch {}
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}
