using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class ScannerHost
{
    private const int MaxRequestBytes = 16 * 1024;
    private const int MaxImageBytes = 16 * 1024 * 1024;
    private const int ImageChunkBytes = 240 * 1024;
    private const string JpegFormat = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static Stream output;

    [STAThread]
    private static void Main()
    {
        using (var input = new BinaryReader(Console.OpenStandardInput()))
        using (output = Console.OpenStandardOutput())
        {
            try
            {
                var request = ReadRequest(input);
                if (request == null)
                {
                    SendError("invalid_request");
                    return;
                }

                Send(new { type = "ready" });
                if (Environment.OSVersion.Platform != PlatformID.Win32NT)
                {
                    SendError("wia_unavailable");
                    return;
                }

                var managerType = Type.GetTypeFromProgID("WIA.DeviceManager");
                if (managerType == null)
                {
                    SendError("wia_unavailable");
                    return;
                }
                dynamic manager = Activator.CreateInstance(managerType);
                dynamic infos = manager.DeviceInfos;
                if (request["action"] == "list") ListDevices(infos);
                else ScanPage(infos, request["id"]);
            }
            catch (EndOfStreamException)
            {
                // The browser closed the pipe before sending a complete request.
            }
            catch (COMException error)
            {
                SendError(WiaError(error));
            }
            catch (Exception)
            {
                SendError("scanner_error");
            }
        }
    }

    private static Dictionary<string, string> ReadRequest(BinaryReader input)
    {
        int size = input.ReadInt32();
        if (size < 1 || size > MaxRequestBytes) return null;
        byte[] bytes = input.ReadBytes(size);
        if (bytes.Length != size) throw new EndOfStreamException();

        var request = Json.Deserialize<Dictionary<string, string>>(Encoding.UTF8.GetString(bytes));
        string action;
        string id;
        if (request == null || !request.TryGetValue("action", out action)) return null;
        if (action == "list") return request;
        if (action == "scan" && request.TryGetValue("id", out id) &&
            !String.IsNullOrEmpty(id) && id.Length <= 2048) return request;
        return null;
    }

    private static void ListDevices(dynamic infos)
    {
        var devices = new List<object>();
        for (int i = 1; i <= (int)infos.Count; i++)
        {
            dynamic info = infos[i];
            if ((int)info.Type != 1) continue;  // WIA ScannerDeviceType
            string id = (string)info.DeviceID;
            string name = (string)info.Properties["Name"].Value;
            devices.Add(new { id, name });
        }
        Send(new { type = "devices", devices });
    }

    private static void ScanPage(dynamic infos, string id)
    {
        for (int i = 1; i <= (int)infos.Count; i++)
        {
            dynamic info = infos[i];
            if ((int)info.Type != 1 || (string)info.DeviceID != id) continue;

            dynamic device = info.Connect();
            if ((int)device.Items.Count == 0)
            {
                SendError("no_source");
                return;
            }

            // WIA uses the first child for the flatbed when one is available.
            dynamic image = device.Items[1].Transfer(JpegFormat);
            if (!String.Equals((string)image.FormatID, JpegFormat, StringComparison.OrdinalIgnoreCase))
            {
                dynamic converter = Activator.CreateInstance(Type.GetTypeFromProgID("WIA.ImageProcess", true));
                converter.Filters.Add(converter.FilterInfos["Convert"].FilterID);
                converter.Filters[1].Properties["FormatID"].Value = JpegFormat;
                converter.Filters[1].Properties["Quality"].Value = 90;
                image = converter.Apply(image);
            }

            byte[] bytes = (byte[])image.FileData.BinaryData;
            if (bytes.Length > MaxImageBytes)
            {
                SendError("image_too_large");
                return;
            }
            if (bytes.Length < 2 || bytes[0] != 0xff || bytes[1] != 0xd8)
            {
                SendError("scanner_error");
                return;
            }

            // Chrome limits individual native messages to 1 MiB, including the JSON envelope.
            for (int offset = 0; offset < bytes.Length; offset += ImageChunkBytes)
            {
                int count = Math.Min(ImageChunkBytes, bytes.Length - offset);
                Send(new { type = "image", data = Convert.ToBase64String(bytes, offset, count) });
            }
            Send(new { type = "done" });
            return;
        }
        SendError("device_missing");
    }

    private static string WiaError(COMException error)
    {
        switch (unchecked((uint)error.ErrorCode))
        {
            case 0x80040154: return "wia_unavailable";
            case 0x80210002: return "paper_jam";
            case 0x80210003: return "no_paper";
            case 0x80210005:
            case 0x80210009:
            case 0x8021000A: return "device_missing";
            case 0x80210006:
            case 0x80210007:
            case 0x8021000D: return "device_busy";
            case 0x80210016: return "cover_open";
            default: return "scanner_error";
        }
    }

    private static void SendError(string code)
    {
        try { Send(new { type = "error", code }); }
        catch (IOException) { }
    }

    private static void Send(object response)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(response));
        byte[] size = BitConverter.GetBytes(bytes.Length);
        output.Write(size, 0, size.Length);
        output.Write(bytes, 0, bytes.Length);
        output.Flush();
    }
}
