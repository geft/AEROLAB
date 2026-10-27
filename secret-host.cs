using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

/// <summary>
/// DPAPI helper for the AEROLAB backend.
///
/// The backend keeps the Garmin Personal API key in a per-user file and needs
/// Windows DPAPI to encrypt it without a native Node addon. The secret travels
/// over stdin/stdout only: it must never appear on a command line, where any
/// process could read it.
/// </summary>
internal static class Program
{
    // Bound into the ciphertext. Changing it makes every stored key unreadable,
    // so treat it as part of the on-disk format rather than a tunable.
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("AEROLAB.Garmin.PersonalApiKey.v1");
    private const string Usage = "Usage: AEROLAB.Secret.exe protect|unprotect";

    private static int Main(string[] args)
    {
        if (args.Length != 1 || (args[0] != "protect" && args[0] != "unprotect"))
        {
            Console.Error.WriteLine(Usage);
            return 2;
        }

        try
        {
            string input = ReadStandardInput();
            if (input.Length == 0)
            {
                Console.Error.WriteLine("No input on stdin.");
                return 3;
            }

            if (args[0] == "protect")
            {
                byte[] cipher = ProtectedData.Protect(
                    Encoding.UTF8.GetBytes(input), Entropy, DataProtectionScope.CurrentUser);
                WriteStandardOutput(Encoding.UTF8.GetBytes(Convert.ToBase64String(cipher)));
            }
            else
            {
                byte[] cipher = Convert.FromBase64String(input);
                WriteStandardOutput(ProtectedData.Unprotect(cipher, Entropy, DataProtectionScope.CurrentUser));
            }

            return 0;
        }
        catch (Exception error)
        {
            // The message never contains the secret; DPAPI errors describe the
            // key material, not the plaintext.
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
            return 1;
        }
    }

    private static string ReadStandardInput()
    {
        using (Stream input = Console.OpenStandardInput())
        using (StreamReader reader = new StreamReader(input, new UTF8Encoding(false), false))
        {
            return reader.ReadToEnd().Trim();
        }
    }

    private static void WriteStandardOutput(byte[] value)
    {
        using (Stream output = Console.OpenStandardOutput())
        {
            output.Write(value, 0, value.Length);
            output.Flush();
        }
    }
}
