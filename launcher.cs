using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace AerolabLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string nodePath = "node";
                string localNode = Path.Combine(baseDir, "bin", "node.exe");

                if (File.Exists(localNode))
                {
                    nodePath = localNode;
                }

                string scriptPath = Path.Combine(baseDir, "scripts", "launch-chrome-app.js");

                if (!File.Exists(scriptPath))
                {
                    MessageBox.Show("Could not find scripts/launch-chrome-app.js in: " + baseDir,
                                    "AEROLAB - File Missing",
                                    MessageBoxButtons.OK,
                                    MessageBoxIcon.Error);
                    return;
                }

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + scriptPath + "\"",
                    WorkingDirectory = baseDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                Process process = Process.Start(psi);
                if (process == null)
                {
                    MessageBox.Show("Failed to launch AEROLAB engine.",
                                    "AEROLAB Error",
                                    MessageBoxButtons.OK,
                                    MessageBoxIcon.Error);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not start AEROLAB:\n\n" + ex.Message + "\n\nPlease ensure Node.js is installed on your computer.",
                                "AEROLAB - Prerequisite Required",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Warning);
            }
        }
    }
}
