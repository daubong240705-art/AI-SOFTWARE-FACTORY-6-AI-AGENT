// Windows-only process owner. No provider configuration or credentials in arguments.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class AsfOwnedJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long ProcessTime, JobTime; public uint Flags; public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint Size; public string Reserved, Desktop, Title; public uint X,Y,Width,Height,CountX,CountY,Fill,Flags; public ushort Show, Reserved2; public IntPtr ReservedPtr, Input, Output, Error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimit info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool DuplicateHandle(IntPtr source, IntPtr handle, IntPtr target, out IntPtr copy, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint length, IntPtr returned);
  static void Check(bool ok) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static IntPtr Copy(IntPtr handle) { IntPtr copy; Check(DuplicateHandle(GetCurrentProcess(), handle, GetCurrentProcess(), out copy, 0, true, 2)); return copy; }
  static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new char[] {' ', '\t', '\n', '\v', '"'}) < 0) return value;
    StringBuilder text = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') text.Append('\\', slashes * 2 + 1).Append(c);
      else text.Append('\\', slashes).Append(c);
      slashes = 0;
    }
    return text.Append('\\', slashes * 2).Append('"').ToString();
  }
  public static bool Empty(string name) {
    IntPtr job = OpenJobObject(4, false, name);
    if (job == IntPtr.Zero) { if (Marshal.GetLastWin32Error() == 2) return true; throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    IntPtr data = Marshal.AllocHGlobal(48);
    try { Check(QueryInformationJobObject(job, 1, data, 48, IntPtr.Zero)); return Marshal.ReadInt32(data, 40) == 0; }
    finally { Marshal.FreeHGlobal(data); CloseHandle(job); }
  }
  public static int Run(string exe, string[] args, string cwd, string name) {
    IntPtr job = CreateJobObject(IntPtr.Zero, name);
    if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    ProcessInfo child = new ProcessInfo();
    object gate = new object(); bool disposed = false;
    IntPtr output = IntPtr.Zero, error = IntPtr.Zero, input = IntPtr.Zero;
    try {
      ExtendedLimit limits = new ExtendedLimit(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)));
      SetHandleInformation(GetStdHandle(-10), 1, 0); // Child must never hold the parent lifetime pipe.
      output = Copy(GetStdHandle(-11)); error = Copy(GetStdHandle(-12));
      IntPtr nul = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
      try { input = Copy(nul); } finally { CloseHandle(nul); }
      Startup startup = new Startup(); startup.Size = (uint)Marshal.SizeOf(startup); startup.Flags = 0x100; startup.Input = input; startup.Output = output; startup.Error = error;
      StringBuilder command = new StringBuilder(Quote(exe)); foreach (string arg in args) command.Append(" ").Append(Quote(arg));
      Check(CreateProcess(exe, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, cwd, ref startup, out child));
      if (!AssignProcessToJobObject(job, child.Process)) { TerminateProcess(child.Process, 1); Check(false); }
      Check(ResumeThread(child.Thread) != 0xffffffff);
      Thread lifetime = new Thread(() => { try { Console.OpenStandardInput().ReadByte(); } catch {} lock(gate) { if(!disposed) TerminateJobObject(job, 130); } }); lifetime.IsBackground = true; lifetime.Start();
      WaitForSingleObject(child.Process, 0xffffffff);
      uint code; Check(GetExitCodeProcess(child.Process, out code));
      return (int)code;
    } finally {
      lock(gate) { disposed = true; TerminateJobObject(job, 130); CloseHandle(job); } // Descendants also die when the root exits.
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
      if (input != IntPtr.Zero) CloseHandle(input);
      if (output != IntPtr.Zero) CloseHandle(output);
      if (error != IntPtr.Zero) CloseHandle(error);
    }
  }
}
