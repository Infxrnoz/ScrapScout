using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

static class Display
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields;
        public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string device, int i, ref DISPLAY_DEVICE dd, int flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE dm);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string device, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);

    const int ENUM_CURRENT = -1, ATTACHED = 0x1, PRIMARY = 0x4;
    const int DM_WIDTH = 0x80000, DM_HEIGHT = 0x100000, DM_FREQ = 0x400000, DM_FIXED = 0x20000000;
    const int CDS_UPDATEREGISTRY = 0x1, CDS_TEST = 0x2, CDS_RESET = 0x40000000;

    // Display config (HDR): QueryDisplayConfig paths -> GDI name + advanced colour state.
    [StructLayout(LayoutKind.Sequential)] struct LUID { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] struct PATH_SOURCE { public LUID adapterId; public uint id, modeInfoIdx, statusFlags; }
    [StructLayout(LayoutKind.Sequential)] struct PATH_TARGET { public LUID adapterId; public uint id, modeInfoIdx, outputTechnology, rotation, scaling, refreshNum, refreshDen, scanLineOrdering; public int targetAvailable; public uint statusFlags; }
    [StructLayout(LayoutKind.Sequential)] struct PATH_INFO { public PATH_SOURCE source; public PATH_TARGET target; public uint flags; }
    [StructLayout(LayoutKind.Sequential, Size = 64)] struct MODE_INFO { public uint infoType, id; public LUID adapterId; }
    [StructLayout(LayoutKind.Sequential)] struct HEADER { public int type, size; public LUID adapterId; public uint id; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct SOURCE_NAME { public HEADER header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string viewGdiDeviceName; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct TARGET_NAME { public HEADER header; public uint flags, outputTechnology; public ushort edidManufactureId, edidProductCodeId; public uint connectorInstance; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string monitorFriendlyDeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string monitorDevicePath; }
    [StructLayout(LayoutKind.Sequential)] struct COLOR_INFO { public HEADER header; public uint value; public int colorEncoding, bitsPerColorChannel; }
    [StructLayout(LayoutKind.Sequential)] struct COLOR_STATE { public HEADER header; public uint value; }

    [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint numPaths, [Out] PATH_INFO[] paths, ref uint numModes, [Out] MODE_INFO[] modes, IntPtr topology);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref SOURCE_NAME info);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref COLOR_INFO info);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref TARGET_NAME info);
    [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref COLOR_STATE info);

    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }

    static Dictionary<string, PATH_TARGET> Targets()
    {
        var map = new Dictionary<string, PATH_TARGET>();
        uint np, nm;
        if (GetDisplayConfigBufferSizes(2, out np, out nm) != 0) return map;
        var paths = new PATH_INFO[np]; var modes = new MODE_INFO[nm];
        if (QueryDisplayConfig(2, ref np, paths, ref nm, modes, IntPtr.Zero) != 0) return map;
        for (int i = 0; i < np; i++)
        {
            var sn = new SOURCE_NAME { header = new HEADER { type = 1, size = Marshal.SizeOf(typeof(SOURCE_NAME)), adapterId = paths[i].source.adapterId, id = paths[i].source.id } };
            if (DisplayConfigGetDeviceInfo(ref sn) == 0 && !map.ContainsKey(sn.viewGdiDeviceName)) map[sn.viewGdiDeviceName] = paths[i].target;
        }
        return map;
    }

    static string FriendlyName(PATH_TARGET t)
    {
        var tn = new TARGET_NAME { header = new HEADER { type = 2, size = Marshal.SizeOf(typeof(TARGET_NAME)), adapterId = t.adapterId, id = t.id } };
        return DisplayConfigGetDeviceInfo(ref tn) == 0 && !string.IsNullOrEmpty(tn.monitorFriendlyDeviceName) ? tn.monitorFriendlyDeviceName : null;
    }

    static int Hdr(PATH_TARGET t)
    {
        var ci = new COLOR_INFO { header = new HEADER { type = 9, size = Marshal.SizeOf(typeof(COLOR_INFO)), adapterId = t.adapterId, id = t.id } };
        if (DisplayConfigGetDeviceInfo(ref ci) != 0) return -1;
        bool supported = (ci.value & 1) != 0, enabled = (ci.value & 2) != 0;
        return !supported ? -1 : enabled ? 1 : 0;
    }

    static string List()
    {
        var targets = Targets();
        var outList = new List<string>();
        var dd = new DISPLAY_DEVICE { cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE)) };
        for (int i = 0; EnumDisplayDevices(null, i, ref dd, 0); i++, dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE)))
        {
            if ((dd.StateFlags & ATTACHED) == 0) continue;
            var cur = new DEVMODE { dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)) };
            if (!EnumDisplaySettings(dd.DeviceName, ENUM_CURRENT, ref cur)) continue;
            var mon = new DISPLAY_DEVICE { cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE)) };
            string monitor = EnumDisplayDevices(dd.DeviceName, 0, ref mon, 0) ? mon.DeviceString : dd.DeviceString;
            var modes = new HashSet<string>();
            var dm = new DEVMODE { dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)) };
            for (int m = 0; EnumDisplaySettings(dd.DeviceName, m, ref dm); m++)
                if (dm.dmBitsPerPel == 32 && dm.dmDisplayFrequency > 1) modes.Add("[" + dm.dmPelsWidth + "," + dm.dmPelsHeight + "," + dm.dmDisplayFrequency + "]");
            PATH_TARGET t;
            int hdr = -1;
            if (targets.TryGetValue(dd.DeviceName, out t)) { hdr = Hdr(t); monitor = FriendlyName(t) ?? monitor; }
            outList.Add("{\"device\":\"" + Esc(dd.DeviceName) + "\",\"monitor\":\"" + Esc(monitor) + "\",\"gpu\":\"" + Esc(dd.DeviceString) + "\",\"primary\":" + ((dd.StateFlags & PRIMARY) != 0 ? "true" : "false")
                + ",\"current\":[" + cur.dmPelsWidth + "," + cur.dmPelsHeight + "," + cur.dmDisplayFrequency + "," + cur.dmDisplayFixedOutput + "]"
                + ",\"hdr\":" + (hdr < 0 ? "null" : hdr == 1 ? "true" : "false") + ",\"modes\":[" + string.Join(",", modes) + "]}");
        }
        return "{\"ok\":true,\"displays\":[" + string.Join(",", outList) + "]}";
    }

    // fixed: 0 = driver default, 1 = keep aspect (black bars), 2 = stretch
    static string SetMode(string device, int w, int h, int hz, int fixedOut, bool test)
    {
        var dm = new DEVMODE { dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)) };
        if (!EnumDisplaySettings(device, ENUM_CURRENT, ref dm)) return "{\"ok\":false,\"error\":\"unknown display\"}";
        dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmDisplayFrequency = hz;
        dm.dmFields = DM_WIDTH | DM_HEIGHT | DM_FREQ;
        if (fixedOut >= 0) { dm.dmDisplayFixedOutput = fixedOut; dm.dmFields |= DM_FIXED; }
        int r = ChangeDisplaySettingsEx(device, ref dm, IntPtr.Zero, test ? CDS_TEST : CDS_UPDATEREGISTRY | CDS_RESET, IntPtr.Zero);
        if (r != 0 && fixedOut >= 0 && !test)
        {
            dm.dmFields &= ~DM_FIXED;
            r = ChangeDisplaySettingsEx(device, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_RESET, IntPtr.Zero);
            if (r == 0) return "{\"ok\":true,\"scaling\":false}";
        }
        return "{\"ok\":" + (r == 0 ? "true" : "false") + ",\"code\":" + r + "}";
    }

    static string SetHdr(string device, bool on)
    {
        PATH_TARGET t;
        if (!Targets().TryGetValue(device, out t)) return "{\"ok\":false,\"error\":\"unknown display\"}";
        if (Hdr(t) < 0) return "{\"ok\":false,\"error\":\"This display doesn't support HDR\"}";
        var cs = new COLOR_STATE { header = new HEADER { type = 10, size = Marshal.SizeOf(typeof(COLOR_STATE)), adapterId = t.adapterId, id = t.id }, value = on ? 1u : 0u };
        int r = DisplayConfigSetDeviceInfo(ref cs);
        return "{\"ok\":" + (r == 0 ? "true" : "false") + ",\"code\":" + r + "}";
    }

    static int N(string s) { int v; return int.TryParse(s, NumberStyles.Integer, Inv, out v) ? v : -1; }

    public static string Handle(string[] p)
    {
        try
        {
            if (p[0] == "displays") return List();
            if ((p[0] == "setmode" || p[0] == "testmode") && p.Length >= 6) return SetMode(p[1], N(p[2]), N(p[3]), N(p[4]), N(p[5]), p[0] == "testmode");
            if (p[0] == "hdr" && p.Length >= 3) return SetHdr(p[1], p[2] == "1");
            return null;
        }
        catch (Exception e) { return "{\"ok\":false,\"error\":\"" + Esc(e.Message) + "\"}"; }
    }
}
