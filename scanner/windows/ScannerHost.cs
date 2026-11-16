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
    private const int HorizontalBedSize = 3074, VerticalBedSize = 3075;
    private const int PageSize = 3097, Preview = 3100, AutoCrop = 4170;
    private const int XResolution = 6147, YResolution = 6148;
    private const int XPosition = 6149, YPosition = 6150;
    private const int XExtent = 6151, YExtent = 6152;
    private const int Orientation = 6156;
    private const int MaxHorizontalSize = 6165, MaxVerticalSize = 6166;
    private const int FinalScan = 0, AutoCropDisabled = 0;
    private const int CustomPage = 2, A4Page = 0, RangeSubtype = 1;
    private const int Portrait = 0, Landscape = 1, RotatedLandscape = 3;
    private const int A4WidthMils = 8267, A4HeightMils = 11692;
    private const int MaxScanDpi = 300;
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
            dynamic item = device.Items[1];
            ConfigureA4Page(device, item);
            dynamic image = item.Transfer(JpegFormat);
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

    internal static void ConfigureA4Page(dynamic device, dynamic item)
    {
        Dictionary<int, object> scan = IndexProperties(item.Properties);
        Dictionary<int, object> root = IndexProperties(device.Properties);
        SetProperty(Property(scan, Preview) ?? Property(root, Preview), FinalScan);
        SetProperty(Property(scan, AutoCrop), AutoCropDisabled);

        dynamic xResolution = Property(scan, XResolution);
        dynamic yResolution = Property(scan, YResolution);
        int originalXResolution = IntValue(xResolution);
        // High resolutions can exceed the browser transfer limit.
        if (xResolution != null && yResolution != null &&
            Math.Max(originalXResolution, IntValue(yResolution)) > MaxScanDpi &&
            SetProperty(xResolution, MaxScanDpi) && !SetProperty(yResolution, MaxScanDpi))
            SetProperty(xResolution, originalXResolution);

        int bedWidth = IntValue(Property(scan, MaxHorizontalSize) ?? Property(root, HorizontalBedSize));
        int bedHeight = IntValue(Property(scan, MaxVerticalSize) ?? Property(root, VerticalBedSize));
        dynamic orientation = Property(scan, Orientation) ?? Property(root, Orientation);
        int currentOrientation = IntValue(orientation);
        bool landscape = currentOrientation == Landscape || currentOrientation == RotatedLandscape;
        bool portraitFits = bedWidth >= A4WidthMils && bedHeight >= A4HeightMils;
        bool landscapeFits = bedWidth >= A4HeightMils && bedHeight >= A4WidthMils;
        if (portraitFits != landscapeFits && landscape != landscapeFits)
        {
            landscape = landscapeFits;
            SetProperty(orientation, landscape ? Landscape : Portrait);
        }

        int paperWidth = landscape ? A4HeightMils : A4WidthMils;
        int paperHeight = landscape ? A4WidthMils : A4HeightMils;
        dynamic xExtent = Property(scan, XExtent);
        dynamic yExtent = Property(scan, YExtent);
        dynamic pageSize = Property(scan, PageSize) ?? Property(root, PageSize);
        if (SetProperty(pageSize, A4Page) &&
            MatchesPaperExtent(xExtent, paperWidth, IntValue(xResolution)) &&
            MatchesPaperExtent(yExtent, paperHeight, IntValue(yResolution)))
            return;

        // Some flatbed drivers expose only the pixel bounds and ignore page presets.
        SetProperty(pageSize, CustomPage);
        dynamic xPosition = Property(scan, XPosition);
        dynamic yPosition = Property(scan, YPosition);
        SetProperty(xPosition, 0);
        SetProperty(yPosition, 0);
        SetPaperExtent(xExtent, paperWidth, bedWidth, IntValue(xResolution), IntValue(xPosition));
        SetPaperExtent(yExtent, paperHeight, bedHeight, IntValue(yResolution), IntValue(yPosition));
    }

    private static Dictionary<int, object> IndexProperties(dynamic properties)
    {
        var indexed = new Dictionary<int, object>();
        for (int i = 1; i <= (int)properties.Count; i++)
        {
            dynamic property = properties[i];
            indexed[(int)property.PropertyID] = property;
        }
        return indexed;
    }

    private static dynamic Property(Dictionary<int, object> properties, int id)
    {
        object property;
        return properties.TryGetValue(id, out property) ? property : null;
    }

    private static int IntValue(dynamic property)
    {
        return property == null ? 0 : (int)property.Value;
    }

    private static bool SetProperty(dynamic property, int value)
    {
        if (property == null) return false;
        try
        {
            if ((int)property.Value == value) return true;
            if ((bool)property.IsReadOnly) return false;
            property.Value = value;
            return true;
        }
        catch (COMException)
        {
            // Optional settings or individual values may be unavailable on a driver.
            return false;
        }
    }

    private static int PaperPixels(int mils, int dpi)
    {
        return (int)Math.Min(Int32.MaxValue, ((long)mils * dpi + 500) / 1000);
    }

    private static bool MatchesPaperExtent(dynamic extent, int paperMils, int dpi)
    {
        if (extent == null || dpi <= 0) return true;
        return Math.Abs((long)IntValue(extent) - PaperPixels(paperMils, dpi)) <= Math.Max(2, dpi / 100);
    }

    private static void SetPaperExtent(dynamic extent, int paperMils, int bedMils, int dpi, int position)
    {
        if (extent == null || dpi <= 0) return;
        // WIA reports the paper and platen in thousandths of an inch.
        int pixels = PaperPixels(paperMils, dpi);
        if (bedMils > 0)
        {
            int available = (int)Math.Min(Int32.MaxValue, (long)bedMils * dpi / 1000);
            pixels = Math.Min(pixels, Math.Max(1, available - Math.Max(0, position)));
        }
        if ((int)extent.SubType == RangeSubtype)
        {
            int min = (int)extent.SubTypeMin;
            int max = (int)extent.SubTypeMax;
            int step = Math.Max(1, (int)extent.SubTypeStep);
            int limit = Math.Min(pixels, max);
            pixels = min + Math.Max(0, limit - min) / step * step;
        }
        if (pixels > 0) SetProperty(extent, pixels);
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
